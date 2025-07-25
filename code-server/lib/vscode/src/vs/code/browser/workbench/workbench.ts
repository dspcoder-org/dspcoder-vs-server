/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isStandalone } from 'vs/base/browser/browser';
import { mainWindow } from 'vs/base/browser/window';
import { VSBuffer, decodeBase64, encodeBase64 } from 'vs/base/common/buffer';
import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { parse } from 'vs/base/common/marshalling';
import { Schemas } from 'vs/base/common/network';
import { posix } from 'vs/base/common/path';
import { isEqual } from 'vs/base/common/resources';
import { ltrim } from 'vs/base/common/strings';
import { URI, UriComponents } from 'vs/base/common/uri';
import product from 'vs/platform/product/common/product';
import { ISecretStorageProvider } from 'vs/platform/secrets/common/secrets';
import { isFolderToOpen, isWorkspaceToOpen } from 'vs/platform/window/common/window';
import type { IWorkbenchConstructionOptions, IWorkspace, IWorkspaceProvider } from 'vs/workbench/browser/web.api';
import { AuthenticationSessionInfo } from 'vs/workbench/services/authentication/browser/authenticationService';
import { extractLocalHostUriMetaDataForPortMapping, TunnelOptions, TunnelCreationOptions } from 'vs/platform/tunnel/common/tunnel';
import type { IURLCallbackProvider } from 'vs/workbench/services/url/browser/urlService';
import { create } from 'vs/workbench/workbench.web.main';

interface ISecretStorageCrypto {
	seal(data: string): Promise<string>;
	unseal(data: string): Promise<string>;
}

class TransparentCrypto implements ISecretStorageCrypto {
	async seal(data: string): Promise<string> {
		return data;
	}

	async unseal(data: string): Promise<string> {
		return data;
	}
}

const enum AESConstants {
	ALGORITHM = 'AES-GCM',
	KEY_LENGTH = 256,
	IV_LENGTH = 12,
}

class ServerKeyedAESCrypto implements ISecretStorageCrypto {
	private _serverKey: Uint8Array | undefined;

	/** Gets whether the algorithm is supported; requires a secure context */
	public static supported() {
		return !!crypto.subtle;
	}

	constructor(private readonly authEndpoint: string) { }

	async seal(data: string): Promise<string> {
		// Get a new key and IV on every change, to avoid the risk of reusing the same key and IV pair with AES-GCM
		// (see also: https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams#properties)
		const iv = mainWindow.crypto.getRandomValues(new Uint8Array(AESConstants.IV_LENGTH));
		// crypto.getRandomValues isn't a good-enough PRNG to generate crypto keys, so we need to use crypto.subtle.generateKey and export the key instead
		const clientKeyObj = await mainWindow.crypto.subtle.generateKey(
			{ name: AESConstants.ALGORITHM as const, length: AESConstants.KEY_LENGTH as const },
			true,
			['encrypt', 'decrypt']
		);

		const clientKey = new Uint8Array(await mainWindow.crypto.subtle.exportKey('raw', clientKeyObj));
		const key = await this.getKey(clientKey);
		const dataUint8Array = new TextEncoder().encode(data);
		const cipherText: ArrayBuffer = await mainWindow.crypto.subtle.encrypt(
			{ name: AESConstants.ALGORITHM as const, iv },
			key,
			dataUint8Array
		);

		// Base64 encode the result and store the ciphertext, the key, and the IV in localStorage
		// Note that the clientKey and IV don't need to be secret
		const result = new Uint8Array([...clientKey, ...iv, ...new Uint8Array(cipherText)]);
		return encodeBase64(VSBuffer.wrap(result));
	}

	async unseal(data: string): Promise<string> {
		// encrypted should contain, in order: the key (32-byte), the IV for AES-GCM (12-byte) and the ciphertext (which has the GCM auth tag at the end)
		// Minimum length must be 44 (key+IV length) + 16 bytes (1 block encrypted with AES - regardless of key size)
		const dataUint8Array = decodeBase64(data);

		if (dataUint8Array.byteLength < 60) {
			throw Error('Invalid length for the value for credentials.crypto');
		}

		const keyLength = AESConstants.KEY_LENGTH / 8;
		const clientKey = dataUint8Array.slice(0, keyLength);
		const iv = dataUint8Array.slice(keyLength, keyLength + AESConstants.IV_LENGTH);
		const cipherText = dataUint8Array.slice(keyLength + AESConstants.IV_LENGTH);

		// Do the decryption and parse the result as JSON
		const key = await this.getKey(clientKey.buffer);
		const decrypted = await mainWindow.crypto.subtle.decrypt(
			{ name: AESConstants.ALGORITHM as const, iv: iv.buffer },
			key,
			cipherText.buffer
		);

		return new TextDecoder().decode(new Uint8Array(decrypted));
	}

	/**
	 * Given a clientKey, returns the CryptoKey object that is used to encrypt/decrypt the data.
	 * The actual key is (clientKey XOR serverKey)
	 */
	private async getKey(clientKey: Uint8Array): Promise<CryptoKey> {
		if (!clientKey || clientKey.byteLength !== AESConstants.KEY_LENGTH / 8) {
			throw Error('Invalid length for clientKey');
		}

		const serverKey = await this.getServerKeyPart();
		const keyData = new Uint8Array(AESConstants.KEY_LENGTH / 8);

		for (let i = 0; i < keyData.byteLength; i++) {
			keyData[i] = clientKey[i]! ^ serverKey[i]!;
		}

		return mainWindow.crypto.subtle.importKey(
			'raw',
			keyData,
			{
				name: AESConstants.ALGORITHM as const,
				length: AESConstants.KEY_LENGTH as const,
			},
			true,
			['encrypt', 'decrypt']
		);
	}

	private async getServerKeyPart(): Promise<Uint8Array> {
		if (this._serverKey) {
			return this._serverKey;
		}

		let attempt = 0;
		let lastError: unknown | undefined;

		while (attempt <= 3) {
			try {
				const res = await fetch(this.authEndpoint, { credentials: 'include', method: 'POST' });
				if (!res.ok) {
					throw new Error(res.statusText);
				}
				const serverKey = new Uint8Array(await await res.arrayBuffer());
				if (serverKey.byteLength !== AESConstants.KEY_LENGTH / 8) {
					throw Error(`The key retrieved by the server is not ${AESConstants.KEY_LENGTH} bit long.`);
				}
				this._serverKey = serverKey;
				return this._serverKey;
			} catch (e) {
				lastError = e;
				attempt++;

				// exponential backoff
				await new Promise(resolve => setTimeout(resolve, attempt * attempt * 100));
			}
		}

		throw lastError;
	}
}

export class LocalStorageSecretStorageProvider implements ISecretStorageProvider {
	private readonly _storageKey = 'secrets.provider';

	private _secretsPromise: Promise<Record<string, string>> = this.load();

	type: 'in-memory' | 'persisted' | 'unknown' = 'persisted';

	constructor(
		private readonly crypto: ISecretStorageCrypto,
	) { }

	private async load(): Promise<Record<string, string>> {
		const record = this.loadAuthSessionFromElement();
		// Get the secrets from localStorage
		const encrypted = localStorage.getItem(this._storageKey);
		if (encrypted) {
			try {
				const decrypted = JSON.parse(await this.crypto.unseal(encrypted));
				return { ...record, ...decrypted };
			} catch (err) {
				// TODO: send telemetry
				console.error('Failed to decrypt secrets from localStorage', err);
				localStorage.removeItem(this._storageKey);
			}
		}

		return record;
	}

	private loadAuthSessionFromElement(): Record<string, string> {
		let authSessionInfo: (AuthenticationSessionInfo & { scopes: string[][] }) | undefined;
		const authSessionElement = mainWindow.document.getElementById('vscode-workbench-auth-session');
		const authSessionElementAttribute = authSessionElement ? authSessionElement.getAttribute('data-settings') : undefined;
		if (authSessionElementAttribute) {
			try {
				authSessionInfo = JSON.parse(authSessionElementAttribute);
			} catch (error) { /* Invalid session is passed. Ignore. */ }
		}

		if (!authSessionInfo) {
			return {};
		}

		const record: Record<string, string> = {};

		// Settings Sync Entry
		record[`${product.urlProtocol}.loginAccount`] = JSON.stringify(authSessionInfo);

		// Auth extension Entry
		if (authSessionInfo.providerId !== 'github') {
			console.error(`Unexpected auth provider: ${authSessionInfo.providerId}. Expected 'github'.`);
			return record;
		}

		const authAccount = JSON.stringify({ extensionId: 'vscode.github-authentication', key: 'github.auth' });
		record[authAccount] = JSON.stringify(authSessionInfo.scopes.map(scopes => ({
			id: authSessionInfo.id,
			scopes,
			accessToken: authSessionInfo.accessToken
		})));

		return record;
	}

	async get(key: string): Promise<string | undefined> {
		const secrets = await this._secretsPromise;
		return secrets[key];
	}
	async set(key: string, value: string): Promise<void> {
		const secrets = await this._secretsPromise;
		secrets[key] = value;
		this._secretsPromise = Promise.resolve(secrets);
		this.save();
	}
	async delete(key: string): Promise<void> {
		const secrets = await this._secretsPromise;
		delete secrets[key];
		this._secretsPromise = Promise.resolve(secrets);
		this.save();
	}

	private async save(): Promise<void> {
		try {
			const encrypted = await this.crypto.seal(JSON.stringify(await this._secretsPromise));
			localStorage.setItem(this._storageKey, encrypted);
		} catch (err) {
			console.error(err);
		}
	}
}


class LocalStorageURLCallbackProvider extends Disposable implements IURLCallbackProvider {

	private static REQUEST_ID = 0;

	private static QUERY_KEYS: ('scheme' | 'authority' | 'path' | 'query' | 'fragment')[] = [
		'scheme',
		'authority',
		'path',
		'query',
		'fragment'
	];

	private readonly _onCallback = this._register(new Emitter<URI>());
	readonly onCallback = this._onCallback.event;

	private pendingCallbacks = new Set<number>();
	private lastTimeChecked = Date.now();
	private checkCallbacksTimeout: unknown | undefined = undefined;
	private onDidChangeLocalStorageDisposable: IDisposable | undefined;

	constructor(private readonly _callbackRoute: string) {
		super();
	}

	create(options: Partial<UriComponents> = {}): URI {
		const id = ++LocalStorageURLCallbackProvider.REQUEST_ID;
		const queryParams: string[] = [`vscode-reqid=${id}`];

		for (const key of LocalStorageURLCallbackProvider.QUERY_KEYS) {
			const value = options[key];

			if (value) {
				queryParams.push(`vscode-${key}=${encodeURIComponent(value)}`);
			}
		}

		// TODO@joao remove eventually
		// https://github.com/microsoft/vscode-dev/issues/62
		// https://github.com/microsoft/vscode/blob/159479eb5ae451a66b5dac3c12d564f32f454796/extensions/github-authentication/src/githubServer.ts#L50-L50
		if (!(options.authority === 'vscode.github-authentication' && options.path === '/dummy')) {
			const key = `vscode-web.url-callbacks[${id}]`;
			localStorage.removeItem(key);

			this.pendingCallbacks.add(id);
			this.startListening();
		}

		const path = (mainWindow.location.pathname + "/" + this._callbackRoute).replace(/\/\/+/g, "/");
		return URI.parse(mainWindow.location.href).with({ path: path, query: queryParams.join('&') });
	}

	private startListening(): void {
		if (this.onDidChangeLocalStorageDisposable) {
			return;
		}

		const fn = () => this.onDidChangeLocalStorage();
		mainWindow.addEventListener('storage', fn);
		this.onDidChangeLocalStorageDisposable = { dispose: () => mainWindow.removeEventListener('storage', fn) };
	}

	private stopListening(): void {
		this.onDidChangeLocalStorageDisposable?.dispose();
		this.onDidChangeLocalStorageDisposable = undefined;
	}

	// this fires every time local storage changes, but we
	// don't want to check more often than once a second
	private async onDidChangeLocalStorage(): Promise<void> {
		const ellapsed = Date.now() - this.lastTimeChecked;

		if (ellapsed > 1000) {
			this.checkCallbacks();
		} else if (this.checkCallbacksTimeout === undefined) {
			this.checkCallbacksTimeout = setTimeout(() => {
				this.checkCallbacksTimeout = undefined;
				this.checkCallbacks();
			}, 1000 - ellapsed);
		}
	}

	private checkCallbacks(): void {
		let pendingCallbacks: Set<number> | undefined;

		for (const id of this.pendingCallbacks) {
			const key = `vscode-web.url-callbacks[${id}]`;
			const result = localStorage.getItem(key);

			if (result !== null) {
				try {
					this._onCallback.fire(URI.revive(JSON.parse(result)));
				} catch (error) {
					console.error(error);
				}

				pendingCallbacks = pendingCallbacks ?? new Set(this.pendingCallbacks);
				pendingCallbacks.delete(id);
				localStorage.removeItem(key);
			}
		}

		if (pendingCallbacks) {
			this.pendingCallbacks = pendingCallbacks;

			if (this.pendingCallbacks.size === 0) {
				this.stopListening();
			}
		}

		this.lastTimeChecked = Date.now();
	}
}

class WorkspaceProvider implements IWorkspaceProvider {

	private static QUERY_PARAM_EMPTY_WINDOW = 'ew';
	private static QUERY_PARAM_FOLDER = 'folder';
	private static QUERY_PARAM_WORKSPACE = 'workspace';

	private static QUERY_PARAM_PAYLOAD = 'payload';

	static create(config: IWorkbenchConstructionOptions & { folderUri?: UriComponents; workspaceUri?: UriComponents }) {
		let foundWorkspace = false;
		let workspace: IWorkspace;
		let payload = Object.create(null);

		const query = new URL(document.location.href).searchParams;
		query.forEach((value, key) => {
			switch (key) {

				// Folder
				case WorkspaceProvider.QUERY_PARAM_FOLDER:
					if (config.remoteAuthority && value.startsWith(posix.sep)) {
						// when connected to a remote and having a value
						// that is a path (begins with a `/`), assume this
						// is a vscode-remote resource as simplified URL.
						workspace = { folderUri: URI.from({ scheme: Schemas.vscodeRemote, path: value, authority: config.remoteAuthority }) };
					} else {
						workspace = { folderUri: URI.parse(value) };
					}
					foundWorkspace = true;
					break;

				// Workspace
				case WorkspaceProvider.QUERY_PARAM_WORKSPACE:
					if (config.remoteAuthority && value.startsWith(posix.sep)) {
						// when connected to a remote and having a value
						// that is a path (begins with a `/`), assume this
						// is a vscode-remote resource as simplified URL.
						workspace = { workspaceUri: URI.from({ scheme: Schemas.vscodeRemote, path: value, authority: config.remoteAuthority }) };
					} else {
						workspace = { workspaceUri: URI.parse(value) };
					}
					foundWorkspace = true;
					break;

				// Empty
				case WorkspaceProvider.QUERY_PARAM_EMPTY_WINDOW:
					workspace = undefined;
					foundWorkspace = true;
					break;

				// Payload
				case WorkspaceProvider.QUERY_PARAM_PAYLOAD:
					try {
						payload = parse(value); // use marshalling#parse() to revive potential URIs
					} catch (error) {
						console.error(error); // possible invalid JSON
					}
					break;
			}
		});

		// If no workspace is provided through the URL, check for config
		// attribute from server
		if (!foundWorkspace) {
			if (config.folderUri) {
				workspace = { folderUri: URI.revive(config.folderUri) };
			} else if (config.workspaceUri) {
				workspace = { workspaceUri: URI.revive(config.workspaceUri) };
			}
		}

		return new WorkspaceProvider(workspace, payload, config);
	}

	readonly trusted = true;

	private constructor(
		readonly workspace: IWorkspace,
		readonly payload: object,
		private readonly config: IWorkbenchConstructionOptions
	) {
	}

	async open(workspace: IWorkspace, options?: { reuse?: boolean; payload?: object }): Promise<boolean> {
		if (options?.reuse && !options.payload && this.isSame(this.workspace, workspace)) {
			return true; // return early if workspace and environment is not changing and we are reusing window
		}

		const targetHref = this.createTargetUrl(workspace, options);
		if (targetHref) {
			if (options?.reuse) {
				mainWindow.location.href = targetHref;
				return true;
			} else {
				let result;
				if (isStandalone()) {
					result = mainWindow.open(targetHref, '_blank', 'toolbar=no'); // ensures to open another 'standalone' window!
				} else {
					result = mainWindow.open(targetHref);
				}

				return !!result;
			}
		}
		return false;
	}

	private createTargetUrl(workspace: IWorkspace, options?: { reuse?: boolean; payload?: object }): string | undefined {

		// Empty
		let targetHref: string | undefined = undefined;
		if (!workspace) {
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_EMPTY_WINDOW}=true`;
		}

		// Folder
		else if (isFolderToOpen(workspace)) {
			const queryParamFolder = this.encodeWorkspacePath(workspace.folderUri);
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_FOLDER}=${queryParamFolder}`;
		}

		// Workspace
		else if (isWorkspaceToOpen(workspace)) {
			const queryParamWorkspace = this.encodeWorkspacePath(workspace.workspaceUri);
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_WORKSPACE}=${queryParamWorkspace}`;
		}

		// Append payload if any
		if (options?.payload) {
			targetHref += `&${WorkspaceProvider.QUERY_PARAM_PAYLOAD}=${encodeURIComponent(JSON.stringify(options.payload))}`;
		}

		return targetHref;
	}

	private encodeWorkspacePath(uri: URI): string {
		if (this.config.remoteAuthority && uri.scheme === Schemas.vscodeRemote) {

			// when connected to a remote and having a folder
			// or workspace for that remote, only use the path
			// as query value to form shorter, nicer URLs.
			// however, we still need to `encodeURIComponent`
			// to ensure to preserve special characters, such
			// as `+` in the path.

			return encodeURIComponent(`${posix.sep}${ltrim(uri.path, posix.sep)}`).replaceAll('%2F', '/');
		}

		return encodeURIComponent(uri.toString(true));
	}

	private isSame(workspaceA: IWorkspace, workspaceB: IWorkspace): boolean {
		if (!workspaceA || !workspaceB) {
			return workspaceA === workspaceB; // both empty
		}

		if (isFolderToOpen(workspaceA) && isFolderToOpen(workspaceB)) {
			return isEqual(workspaceA.folderUri, workspaceB.folderUri); // same workspace
		}

		if (isWorkspaceToOpen(workspaceA) && isWorkspaceToOpen(workspaceB)) {
			return isEqual(workspaceA.workspaceUri, workspaceB.workspaceUri); // same workspace
		}

		return false;
	}

	hasRemote(): boolean {
		if (this.workspace) {
			if (isFolderToOpen(this.workspace)) {
				return this.workspace.folderUri.scheme === Schemas.vscodeRemote;
			}

			if (isWorkspaceToOpen(this.workspace)) {
				return this.workspace.workspaceUri.scheme === Schemas.vscodeRemote;
			}
		}

		return true;
	}
}

(function () {

	// Find config by checking for DOM
	const configElement = mainWindow.document.getElementById('vscode-workbench-web-configuration');
	const configElementAttribute = configElement ? configElement.getAttribute('data-settings') : undefined;
	if (!configElement || !configElementAttribute) {
		throw new Error('Missing web configuration element');
	}
	const config: IWorkbenchConstructionOptions & { folderUri?: UriComponents; workspaceUri?: UriComponents; callbackRoute: string } = { ...JSON.parse(configElementAttribute), remoteAuthority: location.host }
	const secretStorageKeyPath = (window.location.pathname + "/mint-key").replace(/\/\/+/g, "/");
	const secretStorageCrypto = secretStorageKeyPath && ServerKeyedAESCrypto.supported()
		? new ServerKeyedAESCrypto(secretStorageKeyPath) : new TransparentCrypto();

	// Create workbench
	create(mainWindow.document.body, {
		...config,
		windowIndicator: config.windowIndicator ?? { label: '$(remote)', tooltip: `${product.nameShort} Web` },
		settingsSyncOptions: config.settingsSyncOptions ? { enabled: config.settingsSyncOptions.enabled, } : undefined,
		workspaceProvider: WorkspaceProvider.create(config),
		urlCallbackProvider: new LocalStorageURLCallbackProvider(config.callbackRoute),
		resolveExternalUri: (uri: URI): Promise<URI> => {
			let resolvedUri = uri
			const localhostMatch = extractLocalHostUriMetaDataForPortMapping(resolvedUri)
			if (localhostMatch && resolvedUri.authority !== location.host) {
				if (config.productConfiguration && config.productConfiguration.proxyEndpointTemplate) {
					const renderedTemplate = config.productConfiguration.proxyEndpointTemplate
						.replace('{{port}}', localhostMatch.port.toString())
						.replace('{{host}}', window.location.host)
					resolvedUri = URI.parse(new URL(renderedTemplate, window.location.href).toString())
				} else {
					throw new Error(`Failed to resolve external URI: ${uri.toString()}. Could not determine base url because productConfiguration missing.`)
				}
			}
			// If not localhost, return unmodified.
			return Promise.resolve(resolvedUri)
		},
		tunnelProvider: {
			tunnelFactory: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => {
				const onDidDispose: Emitter<void> = new Emitter();
				let isDisposed = false;
				return Promise.resolve({
					remoteAddress: tunnelOptions.remoteAddress,
					localAddress: `localhost:${tunnelOptions.remoteAddress.port}`,
					onDidDispose: onDidDispose.event,
					dispose: () => {
						if (!isDisposed) {
							isDisposed = true;
							onDidDispose.fire();
						}
					}
				})
			}
		},
		secretStorageProvider: config.remoteAuthority && !secretStorageKeyPath
			? undefined /* with a remote without embedder-preferred storage, store on the remote */
			: new LocalStorageSecretStorageProvider(secretStorageCrypto),
	});
})();
