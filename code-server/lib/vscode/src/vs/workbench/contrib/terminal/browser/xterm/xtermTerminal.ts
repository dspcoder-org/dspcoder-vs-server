/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IBuffer, ITerminalOptions, ITheme, Terminal as RawXtermTerminal, LogLevel as XtermLogLevel } from '@xterm/xterm';
import type { ISearchOptions, SearchAddon as SearchAddonType } from '@xterm/addon-search';
import type { Unicode11Addon as Unicode11AddonType } from '@xterm/addon-unicode11';
import type { WebglAddon as WebglAddonType } from '@xterm/addon-webgl';
import type { SerializeAddon as SerializeAddonType } from '@xterm/addon-serialize';
import type { ImageAddon as ImageAddonType } from '@xterm/addon-image';
import type { ClipboardAddon as ClipboardAddonType, ClipboardSelectionType } from '@xterm/addon-clipboard';
import * as dom from 'vs/base/browser/dom';
import { IXtermCore } from 'vs/workbench/contrib/terminal/browser/xterm-private';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IShellIntegration, ITerminalLogService, TerminalSettingId } from 'vs/platform/terminal/common/terminal';
import { ITerminalFont, ITerminalConfiguration } from 'vs/workbench/contrib/terminal/common/terminal';
import { IMarkTracker, IInternalXtermTerminal, IXtermTerminal, IXtermColorProvider, XtermTerminalConstants, IXtermAttachToElementOptions, IDetachedXtermTerminal, ITerminalConfigurationService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { LogLevel } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { MarkNavigationAddon, ScrollPosition } from 'vs/workbench/contrib/terminal/browser/xterm/markNavigationAddon';
import { localize } from 'vs/nls';
import { IColorTheme, IThemeService } from 'vs/platform/theme/common/themeService';
import { PANEL_BACKGROUND } from 'vs/workbench/common/theme';
import { TERMINAL_FOREGROUND_COLOR, TERMINAL_BACKGROUND_COLOR, TERMINAL_CURSOR_FOREGROUND_COLOR, TERMINAL_CURSOR_BACKGROUND_COLOR, ansiColorIdentifiers, TERMINAL_SELECTION_BACKGROUND_COLOR, TERMINAL_FIND_MATCH_BACKGROUND_COLOR, TERMINAL_FIND_MATCH_HIGHLIGHT_BACKGROUND_COLOR, TERMINAL_FIND_MATCH_BORDER_COLOR, TERMINAL_OVERVIEW_RULER_FIND_MATCH_FOREGROUND_COLOR, TERMINAL_FIND_MATCH_HIGHLIGHT_BORDER_COLOR, TERMINAL_OVERVIEW_RULER_CURSOR_FOREGROUND_COLOR, TERMINAL_SELECTION_FOREGROUND_COLOR, TERMINAL_INACTIVE_SELECTION_BACKGROUND_COLOR } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { ShellIntegrationAddon } from 'vs/platform/terminal/common/xterm/shellIntegrationAddon';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { DecorationAddon } from 'vs/workbench/contrib/terminal/browser/xterm/decorationAddon';
import { ITerminalCapabilityStore, ITerminalCommand, TerminalCapability } from 'vs/platform/terminal/common/capabilities/capabilities';
import { Emitter } from 'vs/base/common/event';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { importAMDNodeModule } from 'vs/amdX';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { TerminalContextKeys } from 'vs/workbench/contrib/terminal/common/terminalContextKey';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { debounce } from 'vs/base/common/decorators';
import { MouseWheelClassifier } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { IMouseWheelEvent, StandardWheelEvent } from 'vs/base/browser/mouseEvent';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { AccessibilitySignal, IAccessibilitySignalService } from 'vs/platform/accessibilitySignal/browser/accessibilitySignalService';
// import { scrollbarSliderActiveBackground, scrollbarSliderBackground, scrollbarSliderHoverBackground } from 'vs/platform/theme/common/colorRegistry';

const enum RenderConstants {
	SmoothScrollDuration = 125
}

let ClipboardAddon: typeof ClipboardAddonType;
let ImageAddon: typeof ImageAddonType;
let SearchAddon: typeof SearchAddonType;
let SerializeAddon: typeof SerializeAddonType;
let Unicode11Addon: typeof Unicode11AddonType;
let WebglAddon: typeof WebglAddonType;

function getFullBufferLineAsString(lineIndex: number, buffer: IBuffer): { lineData: string | undefined; lineIndex: number } {
	let line = buffer.getLine(lineIndex);
	if (!line) {
		return { lineData: undefined, lineIndex };
	}
	let lineData = line.translateToString(true);
	while (lineIndex > 0 && line.isWrapped) {
		line = buffer.getLine(--lineIndex);
		if (!line) {
			break;
		}
		lineData = line.translateToString(false) + lineData;
	}
	return { lineData, lineIndex };
}


// DEBUG: This helper can be used to draw image data to the console, it's commented out as we don't
//        want to ship it, but this is very useful for investigating texture atlas issues.
// (console as any).image = (source: ImageData | HTMLCanvasElement, scale: number = 1) => {
// 	function getBox(width: number, height: number) {
// 		return {
// 			string: '+',
// 			style: 'font-size: 1px; padding: ' + Math.floor(height/2) + 'px ' + Math.floor(width/2) + 'px; line-height: ' + height + 'px;'
// 		};
// 	}
// 	if (source instanceof HTMLCanvasElement) {
// 		source = source.getContext('2d')?.getImageData(0, 0, source.width, source.height)!;
// 	}
// 	const canvas = document.createElement('canvas');
// 	canvas.width = source.width;
// 	canvas.height = source.height;
// 	const ctx = canvas.getContext('2d')!;
// 	ctx.putImageData(source, 0, 0);

// 	const sw = source.width * scale;
// 	const sh = source.height * scale;
// 	const dim = getBox(sw, sh);
// 	console.log(
// 		`Image: ${source.width} x ${source.height}\n%c${dim.string}`,
// 		`${dim.style}background: url(${canvas.toDataURL()}); background-size: ${sw}px ${sh}px; background-repeat: no-repeat; color: transparent;`
// 	);
// 	console.groupCollapsed('Zoomed');
// 	console.log(
// 		`%c${dim.string}`,
// 		`${getBox(sw * 10, sh * 10).style}background: url(${canvas.toDataURL()}); background-size: ${sw * 10}px ${sh * 10}px; background-repeat: no-repeat; color: transparent; image-rendering: pixelated;-ms-interpolation-mode: nearest-neighbor;`
// 	);
// 	console.groupEnd();
// };

/**
 * Wraps the xterm object with additional functionality. Interaction with the backing process is out
 * of the scope of this class.
 */
export class XtermTerminal extends Disposable implements IXtermTerminal, IDetachedXtermTerminal, IInternalXtermTerminal {
	/** The raw xterm.js instance */
	readonly raw: RawXtermTerminal;
	private _core: IXtermCore;
	private static _suggestedRendererType: 'dom' | undefined = undefined;
	private static _checkedWebglCompatible = false;
	private _attached?: { container: HTMLElement; options: IXtermAttachToElementOptions };
	private _isPhysicalMouseWheel = MouseWheelClassifier.INSTANCE.isPhysicalMouseWheel();

	// Always on addons
	private _markNavigationAddon: MarkNavigationAddon;
	private _shellIntegrationAddon: ShellIntegrationAddon;
	private _decorationAddon: DecorationAddon;

	// Always on dynamicly imported addons
	private _clipboardAddon?: ClipboardAddonType;

	// Optional addons
	private _searchAddon?: SearchAddonType;
	private _unicode11Addon?: Unicode11AddonType;
	private _webglAddon?: WebglAddonType;
	private _serializeAddon?: SerializeAddonType;
	private _imageAddon?: ImageAddonType;

	private readonly _attachedDisposables = this._register(new DisposableStore());
	private readonly _anyTerminalFocusContextKey: IContextKey<boolean>;
	private readonly _anyFocusedTerminalHasSelection: IContextKey<boolean>;

	private _lastFindResult: { resultIndex: number; resultCount: number } | undefined;
	get findResult(): { resultIndex: number; resultCount: number } | undefined { return this._lastFindResult; }

	get isStdinDisabled(): boolean { return !!this.raw.options.disableStdin; }
	get isGpuAccelerated(): boolean { return !!this._webglAddon; }

	private readonly _onDidRequestRunCommand = this._register(new Emitter<{ command: ITerminalCommand; copyAsHtml?: boolean; noNewLine?: boolean }>());
	readonly onDidRequestRunCommand = this._onDidRequestRunCommand.event;
	private readonly _onDidRequestFocus = this._register(new Emitter<void>());
	readonly onDidRequestFocus = this._onDidRequestFocus.event;
	private readonly _onDidRequestSendText = this._register(new Emitter<string>());
	readonly onDidRequestSendText = this._onDidRequestSendText.event;
	private readonly _onDidRequestFreePort = this._register(new Emitter<string>());
	readonly onDidRequestFreePort = this._onDidRequestFreePort.event;
	private readonly _onDidRequestRefreshDimensions = this._register(new Emitter<void>());
	readonly onDidRequestRefreshDimensions = this._onDidRequestRefreshDimensions.event;
	private readonly _onDidChangeFindResults = this._register(new Emitter<{ resultIndex: number; resultCount: number }>());
	readonly onDidChangeFindResults = this._onDidChangeFindResults.event;
	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	readonly onDidChangeSelection = this._onDidChangeSelection.event;
	private readonly _onDidChangeFocus = this._register(new Emitter<boolean>());
	readonly onDidChangeFocus = this._onDidChangeFocus.event;
	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;

	get markTracker(): IMarkTracker { return this._markNavigationAddon; }
	get shellIntegration(): IShellIntegration { return this._shellIntegrationAddon; }

	get textureAtlas(): Promise<ImageBitmap> | undefined {
		const canvas = this._webglAddon?.textureAtlas;
		if (!canvas) {
			return undefined;
		}
		return createImageBitmap(canvas);
	}

	public get isFocused() {
		if (!this.raw.element) {
			return false;
		}
		return dom.isAncestorOfActiveElement(this.raw.element);
	}

	/**
	 * @param xtermCtor The xterm.js constructor, this is passed in so it can be fetched lazily
	 * outside of this class such that {@link raw} is not nullable.
	 */
	constructor(
		xtermCtor: typeof RawXtermTerminal,
		cols: number,
		rows: number,
		private readonly _xtermColorProvider: IXtermColorProvider,
		private readonly _capabilities: ITerminalCapabilityStore,
		shellIntegrationNonce: string,
		disableShellIntegrationReporting: boolean,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITerminalLogService private readonly _logService: ITerminalLogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IThemeService private readonly _themeService: IThemeService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ITerminalConfigurationService private readonly _terminalConfigurationService: ITerminalConfigurationService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IAccessibilitySignalService private readonly _accessibilitySignalService: IAccessibilitySignalService,
		@ILayoutService layoutService: ILayoutService
	) {
		super();
		const font = this._terminalConfigurationService.getFont(dom.getActiveWindow(), undefined, true);
		const config = this._terminalConfigurationService.config;
		const editorOptions = this._configurationService.getValue<IEditorOptions>('editor');

		this.raw = this._register(new xtermCtor({
			allowProposedApi: true,
			cols,
			rows,
			documentOverride: layoutService.mainContainer.ownerDocument,
			altClickMovesCursor: config.altClickMovesCursor && editorOptions.multiCursorModifier === 'alt',
			scrollback: config.scrollback,
			theme: this.getXtermTheme(),
			drawBoldTextInBrightColors: config.drawBoldTextInBrightColors,
			fontFamily: font.fontFamily,
			fontWeight: config.fontWeight,
			fontWeightBold: config.fontWeightBold,
			fontSize: font.fontSize,
			letterSpacing: font.letterSpacing,
			lineHeight: font.lineHeight,
			logLevel: vscodeToXtermLogLevel(this._logService.getLevel()),
			logger: this._logService,
			minimumContrastRatio: config.minimumContrastRatio,
			tabStopWidth: config.tabStopWidth,
			cursorBlink: config.cursorBlinking,
			cursorStyle: vscodeToXtermCursorStyle<'cursorStyle'>(config.cursorStyle),
			cursorInactiveStyle: vscodeToXtermCursorStyle(config.cursorStyleInactive),
			cursorWidth: config.cursorWidth,
			macOptionIsMeta: config.macOptionIsMeta,
			macOptionClickForcesSelection: config.macOptionClickForcesSelection,
			rightClickSelectsWord: config.rightClickBehavior === 'selectWord',
			fastScrollModifier: 'alt',
			fastScrollSensitivity: config.fastScrollSensitivity,
			scrollSensitivity: config.mouseWheelScrollSensitivity,
			wordSeparator: config.wordSeparators,
			// overviewRuler: {
			// 	width: 14,
			// 	showTopBorder: true,
			// },
			ignoreBracketedPasteMode: config.ignoreBracketedPasteMode,
			rescaleOverlappingGlyphs: config.rescaleOverlappingGlyphs,
			windowOptions: {
				getWinSizePixels: true,
				getCellSizePixels: true,
				getWinSizeChars: true,
			},
		}));
		this._updateSmoothScrolling();
		this._core = (this.raw as any)._core as IXtermCore;

		this._register(this._configurationService.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration(TerminalSettingId.GpuAcceleration)) {
				XtermTerminal._suggestedRendererType = undefined;
			}
			if (e.affectsConfiguration('terminal.integrated') || e.affectsConfiguration('editor.fastScrollSensitivity') || e.affectsConfiguration('editor.mouseWheelScrollSensitivity') || e.affectsConfiguration('editor.multiCursorModifier')) {
				this.updateConfig();
			}
			if (e.affectsConfiguration(TerminalSettingId.UnicodeVersion)) {
				this._updateUnicodeVersion();
			}
			if (e.affectsConfiguration(TerminalSettingId.ShellIntegrationDecorationsEnabled)) {
				this._updateTheme();
			}
		}));

		this._register(this._themeService.onDidColorThemeChange(theme => this._updateTheme(theme)));
		this._register(this._logService.onDidChangeLogLevel(e => this.raw.options.logLevel = vscodeToXtermLogLevel(e)));

		// Refire events
		this._register(this.raw.onSelectionChange(() => {
			this._onDidChangeSelection.fire();
			if (this.isFocused) {
				this._anyFocusedTerminalHasSelection.set(this.raw.hasSelection());
			}
		}));

		// Load addons
		this._updateUnicodeVersion();
		this._markNavigationAddon = this._instantiationService.createInstance(MarkNavigationAddon, _capabilities);
		this.raw.loadAddon(this._markNavigationAddon);
		this._decorationAddon = this._instantiationService.createInstance(DecorationAddon, this._capabilities);
		this._register(this._decorationAddon.onDidRequestRunCommand(e => this._onDidRequestRunCommand.fire(e)));
		this.raw.loadAddon(this._decorationAddon);
		this._shellIntegrationAddon = new ShellIntegrationAddon(shellIntegrationNonce, disableShellIntegrationReporting, this._telemetryService, this._logService);
		this.raw.loadAddon(this._shellIntegrationAddon);
		this._getClipboardAddonConstructor().then(ClipboardAddon => {
			this._clipboardAddon = this._instantiationService.createInstance(ClipboardAddon, undefined, {
				async readText(type: ClipboardSelectionType): Promise<string> {
					return _clipboardService.readText(type === 'p' ? 'selection' : 'clipboard');
				},
				async writeText(type: ClipboardSelectionType, text: string): Promise<void> {
					return _clipboardService.writeText(text, type === 'p' ? 'selection' : 'clipboard');
				}
			});
			this.raw.loadAddon(this._clipboardAddon);
		});

		this._anyTerminalFocusContextKey = TerminalContextKeys.focusInAny.bindTo(contextKeyService);
		this._anyFocusedTerminalHasSelection = TerminalContextKeys.textSelectedInFocused.bindTo(contextKeyService);
	}

	*getBufferReverseIterator(): IterableIterator<string> {
		for (let i = this.raw.buffer.active.length; i >= 0; i--) {
			const { lineData, lineIndex } = getFullBufferLineAsString(i, this.raw.buffer.active);
			if (lineData) {
				i = lineIndex;
				yield lineData;
			}
		}
	}

	async getContentsAsHtml(): Promise<string> {
		if (!this._serializeAddon) {
			const Addon = await this._getSerializeAddonConstructor();
			this._serializeAddon = new Addon();
			this.raw.loadAddon(this._serializeAddon);
		}

		return this._serializeAddon.serializeAsHTML();
	}

	async getSelectionAsHtml(command?: ITerminalCommand): Promise<string> {
		if (!this._serializeAddon) {
			const Addon = await this._getSerializeAddonConstructor();
			this._serializeAddon = new Addon();
			this.raw.loadAddon(this._serializeAddon);
		}
		if (command) {
			const length = command.getOutput()?.length;
			const row = command.marker?.line;
			if (!length || !row) {
				throw new Error(`No row ${row} or output length ${length} for command ${command}`);
			}
			this.raw.select(0, row + 1, length - Math.floor(length / this.raw.cols));
		}
		const result = this._serializeAddon.serializeAsHTML({ onlySelection: true });
		if (command) {
			this.raw.clearSelection();
		}
		return result;
	}

	attachToElement(container: HTMLElement, partialOptions?: Partial<IXtermAttachToElementOptions>): HTMLElement {
		const options: IXtermAttachToElementOptions = { enableGpu: true, ...partialOptions };
		if (!this._attached) {
			this.raw.open(container);
		}

		// TODO: Move before open so the DOM renderer doesn't initialize
		if (options.enableGpu) {
			if (this._shouldLoadWebgl()) {
				this._enableWebglRenderer();
			}
		}

		if (!this.raw.element || !this.raw.textarea) {
			throw new Error('xterm elements not set after open');
		}

		const ad = this._attachedDisposables;
		ad.clear();
		ad.add(dom.addDisposableListener(this.raw.textarea, 'focus', () => this._setFocused(true)));
		ad.add(dom.addDisposableListener(this.raw.textarea, 'blur', () => this._setFocused(false)));
		ad.add(dom.addDisposableListener(this.raw.textarea, 'focusout', () => this._setFocused(false)));

		// Track wheel events in mouse wheel classifier and update smoothScrolling when it changes
		// as it must be disabled when a trackpad is used
		ad.add(dom.addDisposableListener(this.raw.element, dom.EventType.MOUSE_WHEEL, (e: IMouseWheelEvent) => {
			const classifier = MouseWheelClassifier.INSTANCE;
			classifier.acceptStandardWheelEvent(new StandardWheelEvent(e));
			const value = classifier.isPhysicalMouseWheel();
			if (value !== this._isPhysicalMouseWheel) {
				this._isPhysicalMouseWheel = value;
				this._updateSmoothScrolling();
			}
		}, { passive: true }));

		this._attached = { container, options };
		// Screen must be created at this point as xterm.open is called
		return this._attached?.container.querySelector('.xterm-screen')!;
	}

	private _setFocused(isFocused: boolean) {
		this._onDidChangeFocus.fire(isFocused);
		this._anyTerminalFocusContextKey.set(isFocused);
		this._anyFocusedTerminalHasSelection.set(isFocused && this.raw.hasSelection());
	}

	write(data: string | Uint8Array, callback?: () => void): void {
		this.raw.write(data, callback);
	}

	resize(columns: number, rows: number): void {
		this.raw.resize(columns, rows);
	}

	updateConfig(): void {
		const config = this._terminalConfigurationService.config;
		this.raw.options.altClickMovesCursor = config.altClickMovesCursor;
		this._setCursorBlink(config.cursorBlinking);
		this._setCursorStyle(config.cursorStyle);
		this._setCursorStyleInactive(config.cursorStyleInactive);
		this._setCursorWidth(config.cursorWidth);
		this.raw.options.scrollback = config.scrollback;
		this.raw.options.drawBoldTextInBrightColors = config.drawBoldTextInBrightColors;
		this.raw.options.minimumContrastRatio = config.minimumContrastRatio;
		this.raw.options.tabStopWidth = config.tabStopWidth;
		this.raw.options.fastScrollSensitivity = config.fastScrollSensitivity;
		this.raw.options.scrollSensitivity = config.mouseWheelScrollSensitivity;
		this.raw.options.macOptionIsMeta = config.macOptionIsMeta;
		const editorOptions = this._configurationService.getValue<IEditorOptions>('editor');
		this.raw.options.altClickMovesCursor = config.altClickMovesCursor && editorOptions.multiCursorModifier === 'alt';
		this.raw.options.macOptionClickForcesSelection = config.macOptionClickForcesSelection;
		this.raw.options.rightClickSelectsWord = config.rightClickBehavior === 'selectWord';
		this.raw.options.wordSeparator = config.wordSeparators;
		this.raw.options.customGlyphs = config.customGlyphs;
		this.raw.options.ignoreBracketedPasteMode = config.ignoreBracketedPasteMode;
		this.raw.options.rescaleOverlappingGlyphs = config.rescaleOverlappingGlyphs;
		// this.raw.options.overviewRuler = {
		// 	width: 14,
		// 	showTopBorder: true,
		// };
		this._updateSmoothScrolling();
		if (this._attached?.options.enableGpu) {
			if (this._shouldLoadWebgl()) {
				this._enableWebglRenderer();
			} else {
				this._disposeOfWebglRenderer();
			}
		}
	}

	private _updateSmoothScrolling() {
		this.raw.options.smoothScrollDuration = this._terminalConfigurationService.config.smoothScrolling && this._isPhysicalMouseWheel ? RenderConstants.SmoothScrollDuration : 0;
	}

	private _shouldLoadWebgl(): boolean {
		return (this._terminalConfigurationService.config.gpuAcceleration === 'auto' && XtermTerminal._suggestedRendererType === undefined) || this._terminalConfigurationService.config.gpuAcceleration === 'on';
	}

	forceRedraw() {
		this.raw.clearTextureAtlas();
	}

	clearDecorations(): void {
		this._decorationAddon?.clearDecorations();
	}

	forceRefresh() {
		this._core.viewport?._innerRefresh();
	}

	async findNext(term: string, searchOptions: ISearchOptions): Promise<boolean> {
		this._updateFindColors(searchOptions);
		return (await this._getSearchAddon()).findNext(term, searchOptions);
	}

	async findPrevious(term: string, searchOptions: ISearchOptions): Promise<boolean> {
		this._updateFindColors(searchOptions);
		return (await this._getSearchAddon()).findPrevious(term, searchOptions);
	}

	private _updateFindColors(searchOptions: ISearchOptions): void {
		const theme = this._themeService.getColorTheme();
		// Theme color names align with monaco/vscode whereas xterm.js has some different naming.
		// The mapping is as follows:
		// - findMatch -> activeMatch
		// - findMatchHighlight -> match
		const terminalBackground = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(PANEL_BACKGROUND);
		const findMatchBackground = theme.getColor(TERMINAL_FIND_MATCH_BACKGROUND_COLOR);
		const findMatchBorder = theme.getColor(TERMINAL_FIND_MATCH_BORDER_COLOR);
		const findMatchOverviewRuler = theme.getColor(TERMINAL_OVERVIEW_RULER_CURSOR_FOREGROUND_COLOR);
		const findMatchHighlightBackground = theme.getColor(TERMINAL_FIND_MATCH_HIGHLIGHT_BACKGROUND_COLOR);
		const findMatchHighlightBorder = theme.getColor(TERMINAL_FIND_MATCH_HIGHLIGHT_BORDER_COLOR);
		const findMatchHighlightOverviewRuler = theme.getColor(TERMINAL_OVERVIEW_RULER_FIND_MATCH_FOREGROUND_COLOR);
		searchOptions.decorations = {
			activeMatchBackground: findMatchBackground?.toString(),
			activeMatchBorder: findMatchBorder?.toString() || 'transparent',
			activeMatchColorOverviewRuler: findMatchOverviewRuler?.toString() || 'transparent',
			// decoration bgs don't support the alpha channel so blend it with the regular bg
			matchBackground: terminalBackground ? findMatchHighlightBackground?.blend(terminalBackground).toString() : undefined,
			matchBorder: findMatchHighlightBorder?.toString() || 'transparent',
			matchOverviewRuler: findMatchHighlightOverviewRuler?.toString() || 'transparent'
		};
	}

	private _searchAddonPromise: Promise<SearchAddonType> | undefined;
	private _getSearchAddon(): Promise<SearchAddonType> {
		if (!this._searchAddonPromise) {
			this._searchAddonPromise = this._getSearchAddonConstructor().then((AddonCtor) => {
				this._searchAddon = new AddonCtor({ highlightLimit: XtermTerminalConstants.SearchHighlightLimit });
				this.raw.loadAddon(this._searchAddon);
				this._searchAddon.onDidChangeResults((results: { resultIndex: number; resultCount: number }) => {
					this._lastFindResult = results;
					this._onDidChangeFindResults.fire(results);
				});
				return this._searchAddon;
			});
		}
		return this._searchAddonPromise;
	}

	clearSearchDecorations(): void {
		this._searchAddon?.clearDecorations();
	}

	clearActiveSearchDecoration(): void {
		this._searchAddon?.clearActiveDecoration();
	}

	getFont(): ITerminalFont {
		return this._terminalConfigurationService.getFont(dom.getWindow(this.raw.element), this._core);
	}

	getLongestViewportWrappedLineLength(): number {
		let maxLineLength = 0;
		for (let i = this.raw.buffer.active.length - 1; i >= this.raw.buffer.active.viewportY; i--) {
			const lineInfo = this._getWrappedLineCount(i, this.raw.buffer.active);
			maxLineLength = Math.max(maxLineLength, ((lineInfo.lineCount * this.raw.cols) - lineInfo.endSpaces) || 0);
			i = lineInfo.currentIndex;
		}
		return maxLineLength;
	}

	private _getWrappedLineCount(index: number, buffer: IBuffer): { lineCount: number; currentIndex: number; endSpaces: number } {
		let line = buffer.getLine(index);
		if (!line) {
			throw new Error('Could not get line');
		}
		let currentIndex = index;
		let endSpaces = 0;
		// line.length may exceed cols as it doesn't necessarily trim the backing array on resize
		for (let i = Math.min(line.length, this.raw.cols) - 1; i >= 0; i--) {
			if (!line?.getCell(i)?.getChars()) {
				endSpaces++;
			} else {
				break;
			}
		}
		while (line?.isWrapped && currentIndex > 0) {
			currentIndex--;
			line = buffer.getLine(currentIndex);
		}
		return { lineCount: index - currentIndex + 1, currentIndex, endSpaces };
	}

	scrollDownLine(): void {
		this.raw.scrollLines(1);
	}

	scrollDownPage(): void {
		this.raw.scrollPages(1);
	}

	scrollToBottom(): void {
		this.raw.scrollToBottom();
	}

	scrollUpLine(): void {
		this.raw.scrollLines(-1);
	}

	scrollUpPage(): void {
		this.raw.scrollPages(-1);
	}

	scrollToTop(): void {
		this.raw.scrollToTop();
	}

	scrollToLine(line: number, position: ScrollPosition = ScrollPosition.Top): void {
		this.markTracker.scrollToLine(line, position);
	}

	clearBuffer(): void {
		this.raw.clear();
		// xterm.js does not clear the first prompt, so trigger these to simulate
		// the prompt being written
		this._capabilities.get(TerminalCapability.CommandDetection)?.handlePromptStart();
		this._capabilities.get(TerminalCapability.CommandDetection)?.handleCommandStart();
		this._accessibilitySignalService.playSignal(AccessibilitySignal.clear);
	}

	hasSelection(): boolean {
		return this.raw.hasSelection();
	}

	clearSelection(): void {
		this.raw.clearSelection();
	}

	selectMarkedRange(fromMarkerId: string, toMarkerId: string, scrollIntoView = false) {
		const detectionCapability = this.shellIntegration.capabilities.get(TerminalCapability.BufferMarkDetection);
		if (!detectionCapability) {
			return;
		}

		const start = detectionCapability.getMark(fromMarkerId);
		const end = detectionCapability.getMark(toMarkerId);
		if (start === undefined || end === undefined) {
			return;
		}

		this.raw.selectLines(start.line, end.line);
		if (scrollIntoView) {
			this.raw.scrollToLine(start.line);
		}
	}

	selectAll(): void {
		this.raw.focus();
		this.raw.selectAll();
	}

	focus(): void {
		this.raw.focus();
	}

	async copySelection(asHtml?: boolean, command?: ITerminalCommand): Promise<void> {
		if (this.hasSelection() || (asHtml && command)) {
			if (asHtml) {
				const textAsHtml = await this.getSelectionAsHtml(command);
				function listener(e: any) {
					if (!e.clipboardData.types.includes('text/plain')) {
						e.clipboardData.setData('text/plain', command?.getOutput() ?? '');
					}
					e.clipboardData.setData('text/html', textAsHtml);
					e.preventDefault();
				}
				const doc = dom.getDocument(this.raw.element);
				doc.addEventListener('copy', listener);
				doc.execCommand('copy');
				doc.removeEventListener('copy', listener);
			} else {
				await this._clipboardService.writeText(this.raw.getSelection());
			}
		} else {
			this._notificationService.warn(localize('terminal.integrated.copySelection.noSelection', 'The terminal has no selection to copy'));
		}
	}

	private _setCursorBlink(blink: boolean): void {
		if (this.raw.options.cursorBlink !== blink) {
			this.raw.options.cursorBlink = blink;
			this.raw.refresh(0, this.raw.rows - 1);
		}
	}

	private _setCursorStyle(style: ITerminalConfiguration['cursorStyle']): void {
		const mapped = vscodeToXtermCursorStyle<'cursorStyle'>(style);
		if (this.raw.options.cursorStyle !== mapped) {
			this.raw.options.cursorStyle = mapped;
		}
	}

	private _setCursorStyleInactive(style: ITerminalConfiguration['cursorStyleInactive']): void {
		const mapped = vscodeToXtermCursorStyle(style);
		if (this.raw.options.cursorInactiveStyle !== mapped) {
			this.raw.options.cursorInactiveStyle = mapped;
		}
	}

	private _setCursorWidth(width: number): void {
		if (this.raw.options.cursorWidth !== width) {
			this.raw.options.cursorWidth = width;
		}
	}

	private async _enableWebglRenderer(): Promise<void> {
		if (!this.raw.element || this._webglAddon) {
			return;
		}

		// Check if the the WebGL renderer is compatible with xterm.js:
		// - https://github.com/microsoft/vscode/issues/190195
		// - https://github.com/xtermjs/xterm.js/issues/4665
		// - https://bugs.chromium.org/p/chromium/issues/detail?id=1476475
		if (!XtermTerminal._checkedWebglCompatible) {
			XtermTerminal._checkedWebglCompatible = true;
			const checkCanvas = document.createElement('canvas');
			const checkGl = checkCanvas.getContext('webgl2');
			const debugInfo = checkGl?.getExtension('WEBGL_debug_renderer_info');
			if (checkGl && debugInfo) {
				const renderer = checkGl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
				if (renderer.startsWith('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)')) {
					this._disableWebglForThisSession();
					return;
				}
			}
		}

		const Addon = await this._getWebglAddonConstructor();
		this._webglAddon = new Addon();
		try {
			this.raw.loadAddon(this._webglAddon);
			this._logService.trace('Webgl was loaded');
			this._webglAddon.onContextLoss(() => {
				this._logService.info(`Webgl lost context, disposing of webgl renderer`);
				this._disposeOfWebglRenderer();
			});
			this._refreshImageAddon();
			// WebGL renderer cell dimensions differ from the DOM renderer, make sure the terminal
			// gets resized after the webgl addon is loaded
			this._onDidRequestRefreshDimensions.fire();
			// Uncomment to add the texture atlas to the DOM
			// setTimeout(() => {
			// 	if (this._webglAddon?.textureAtlas) {
			// 		document.body.appendChild(this._webglAddon?.textureAtlas);
			// 	}
			// }, 5000);
		} catch (e) {
			this._logService.warn(`Webgl could not be loaded. Falling back to the DOM renderer`, e);
			this._disableWebglForThisSession();
		}
	}

	private _disableWebglForThisSession() {
		XtermTerminal._suggestedRendererType = 'dom';
		this._disposeOfWebglRenderer();
	}

	@debounce(100)
	private async _refreshImageAddon(): Promise<void> {
		// Only allow the image addon when webgl is being used to avoid possible GPU issues
		if (this._terminalConfigurationService.config.enableImages && this._webglAddon) {
			if (!this._imageAddon) {
				const AddonCtor = await this._getImageAddonConstructor();
				this._imageAddon = new AddonCtor();
				this.raw.loadAddon(this._imageAddon);
			}
		} else {
			try {
				this._imageAddon?.dispose();
			} catch {
				// ignore
			}
			this._imageAddon = undefined;
		}
	}

	protected async _getClipboardAddonConstructor(): Promise<typeof ClipboardAddonType> {
		if (!ClipboardAddon) {
			ClipboardAddon = (await importAMDNodeModule<typeof import('@xterm/addon-clipboard')>('@xterm/addon-clipboard', 'lib/addon-clipboard.js')).ClipboardAddon;
		}
		return ClipboardAddon;
	}

	protected async _getImageAddonConstructor(): Promise<typeof ImageAddonType> {
		if (!ImageAddon) {
			ImageAddon = (await importAMDNodeModule<typeof import('@xterm/addon-image')>('@xterm/addon-image', 'lib/addon-image.js')).ImageAddon;
		}
		return ImageAddon;
	}

	protected async _getSearchAddonConstructor(): Promise<typeof SearchAddonType> {
		if (!SearchAddon) {
			SearchAddon = (await importAMDNodeModule<typeof import('@xterm/addon-search')>('@xterm/addon-search', 'lib/addon-search.js')).SearchAddon;
		}
		return SearchAddon;
	}

	protected async _getUnicode11Constructor(): Promise<typeof Unicode11AddonType> {
		if (!Unicode11Addon) {
			Unicode11Addon = (await importAMDNodeModule<typeof import('@xterm/addon-unicode11')>('@xterm/addon-unicode11', 'lib/addon-unicode11.js')).Unicode11Addon;
		}
		return Unicode11Addon;
	}

	protected async _getWebglAddonConstructor(): Promise<typeof WebglAddonType> {
		if (!WebglAddon) {
			WebglAddon = (await importAMDNodeModule<typeof import('@xterm/addon-webgl')>('@xterm/addon-webgl', 'lib/addon-webgl.js')).WebglAddon;
		}
		return WebglAddon;
	}

	protected async _getSerializeAddonConstructor(): Promise<typeof SerializeAddonType> {
		if (!SerializeAddon) {
			SerializeAddon = (await importAMDNodeModule<typeof import('@xterm/addon-serialize')>('@xterm/addon-serialize', 'lib/addon-serialize.js')).SerializeAddon;
		}
		return SerializeAddon;
	}

	private _disposeOfWebglRenderer(): void {
		try {
			this._webglAddon?.dispose();
		} catch {
			// ignore
		}
		this._webglAddon = undefined;
		this._refreshImageAddon();
	}

	getXtermTheme(theme?: IColorTheme): ITheme {
		if (!theme) {
			theme = this._themeService.getColorTheme();
		}

		const config = this._terminalConfigurationService.config;
		const hideOverviewRuler = ['never', 'gutter'].includes(config.shellIntegration?.decorationsEnabled ?? '');
		hideOverviewRuler // A placeholder to avoid unused variable warning
		const foregroundColor = theme.getColor(TERMINAL_FOREGROUND_COLOR);
		const backgroundColor = this._xtermColorProvider.getBackgroundColor(theme);
		const cursorColor = theme.getColor(TERMINAL_CURSOR_FOREGROUND_COLOR) || foregroundColor;
		const cursorAccentColor = theme.getColor(TERMINAL_CURSOR_BACKGROUND_COLOR) || backgroundColor;
		const selectionBackgroundColor = theme.getColor(TERMINAL_SELECTION_BACKGROUND_COLOR);
		const selectionInactiveBackgroundColor = theme.getColor(TERMINAL_INACTIVE_SELECTION_BACKGROUND_COLOR);
		const selectionForegroundColor = theme.getColor(TERMINAL_SELECTION_FOREGROUND_COLOR) || undefined;

		return {
			background: backgroundColor?.toString(),
			foreground: foregroundColor?.toString(),
			cursor: cursorColor?.toString(),
			cursorAccent: cursorAccentColor?.toString(),
			selectionBackground: selectionBackgroundColor?.toString(),
			selectionInactiveBackground: selectionInactiveBackgroundColor?.toString(),
			selectionForeground: selectionForegroundColor?.toString(),
			// overviewRulerBorder: hideOverviewRuler ? '#0000' : theme.getColor(TERMINAL_OVERVIEW_RULER_BORDER_COLOR)?.toString(),
			// scrollbarSliderActiveBackground: theme.getColor(scrollbarSliderActiveBackground)?.toString(),
			// scrollbarSliderBackground: theme.getColor(scrollbarSliderBackground)?.toString(),
			// scrollbarSliderHoverBackground: theme.getColor(scrollbarSliderHoverBackground)?.toString(),
			black: theme.getColor(ansiColorIdentifiers[0])?.toString(),
			red: theme.getColor(ansiColorIdentifiers[1])?.toString(),
			green: theme.getColor(ansiColorIdentifiers[2])?.toString(),
			yellow: theme.getColor(ansiColorIdentifiers[3])?.toString(),
			blue: theme.getColor(ansiColorIdentifiers[4])?.toString(),
			magenta: theme.getColor(ansiColorIdentifiers[5])?.toString(),
			cyan: theme.getColor(ansiColorIdentifiers[6])?.toString(),
			white: theme.getColor(ansiColorIdentifiers[7])?.toString(),
			brightBlack: theme.getColor(ansiColorIdentifiers[8])?.toString(),
			brightRed: theme.getColor(ansiColorIdentifiers[9])?.toString(),
			brightGreen: theme.getColor(ansiColorIdentifiers[10])?.toString(),
			brightYellow: theme.getColor(ansiColorIdentifiers[11])?.toString(),
			brightBlue: theme.getColor(ansiColorIdentifiers[12])?.toString(),
			brightMagenta: theme.getColor(ansiColorIdentifiers[13])?.toString(),
			brightCyan: theme.getColor(ansiColorIdentifiers[14])?.toString(),
			brightWhite: theme.getColor(ansiColorIdentifiers[15])?.toString()
		};
	}

	private _updateTheme(theme?: IColorTheme): void {
		this.raw.options.theme = this.getXtermTheme(theme);
	}

	refresh() {
		this._updateTheme();
		this._decorationAddon.refreshLayouts();
	}

	private async _updateUnicodeVersion(): Promise<void> {
		if (!this._unicode11Addon && this._terminalConfigurationService.config.unicodeVersion === '11') {
			const Addon = await this._getUnicode11Constructor();
			this._unicode11Addon = new Addon();
			this.raw.loadAddon(this._unicode11Addon);
		}
		if (this.raw.unicode.activeVersion !== this._terminalConfigurationService.config.unicodeVersion) {
			this.raw.unicode.activeVersion = this._terminalConfigurationService.config.unicodeVersion;
		}
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	_writeText(data: string): void {
		this.raw.write(data);
	}

	override dispose(): void {
		this._anyTerminalFocusContextKey.reset();
		this._anyFocusedTerminalHasSelection.reset();
		this._onDidDispose.fire();
		super.dispose();
	}
}

export function getXtermScaledDimensions(w: Window, font: ITerminalFont, width: number, height: number): { rows: number; cols: number } | null {
	if (!font.charWidth || !font.charHeight) {
		return null;
	}

	// Because xterm.js converts from CSS pixels to actual pixels through
	// the use of canvas, window.devicePixelRatio needs to be used here in
	// order to be precise. font.charWidth/charHeight alone as insufficient
	// when window.devicePixelRatio changes.
	const scaledWidthAvailable = width * w.devicePixelRatio;

	const scaledCharWidth = font.charWidth * w.devicePixelRatio + font.letterSpacing;
	const cols = Math.max(Math.floor(scaledWidthAvailable / scaledCharWidth), 1);

	const scaledHeightAvailable = height * w.devicePixelRatio;
	const scaledCharHeight = Math.ceil(font.charHeight * w.devicePixelRatio);
	const scaledLineHeight = Math.floor(scaledCharHeight * font.lineHeight);
	const rows = Math.max(Math.floor(scaledHeightAvailable / scaledLineHeight), 1);

	return { rows, cols };
}

function vscodeToXtermLogLevel(logLevel: LogLevel): XtermLogLevel {
	switch (logLevel) {
		case LogLevel.Trace: return 'trace';
		case LogLevel.Debug: return 'debug';
		case LogLevel.Info: return 'info';
		case LogLevel.Warning: return 'warn';
		case LogLevel.Error: return 'error';
		default: return 'off';
	}
}

interface ICursorStyleVscodeToXtermMap {
	'cursorStyle': NonNullable<ITerminalOptions['cursorStyle']>;
	'cursorStyleInactive': NonNullable<ITerminalOptions['cursorInactiveStyle']>;
}
function vscodeToXtermCursorStyle<T extends 'cursorStyle' | 'cursorStyleInactive'>(style: ITerminalConfiguration[T]): ICursorStyleVscodeToXtermMap[T] {
	// 'line' is used instead of bar in VS Code to be consistent with editor.cursorStyle
	if (style === 'line') {
		return 'bar';
	}
	return style as ICursorStyleVscodeToXtermMap[T];
}
