/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { dirs } = require('./dirs');
const { setupBuildYarnrc } = require('./setupBuildYarnrc');
const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const root = path.dirname(path.dirname(__dirname));

function run(command, args, opts) {
	console.log('$ ' + command + ' ' + args.join(' '));

	const result = cp.spawnSync(command, args, opts);

	if (result.error) {
		console.error(`ERR Failed to spawn process: ${result.error}`);
		process.exit(1);
	} else if (result.status !== 0) {
		console.error(`ERR Process exited with code: ${result.status}`);
		process.exit(result.status);
	}
}

/**
 * @param {string} dir
 * @param {*} [opts]
 */
function yarnInstall(dir, opts) {
	opts = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: dir,
		stdio: 'inherit',
		shell: true
	};

	const raw = process.env['npm_config_argv'] || '{}';
	const argv = JSON.parse(raw);
	const original = argv.original || [];
	const args = original.filter(arg => arg === '--ignore-optional' || arg === '--frozen-lockfile' || arg === '--check-files');

	if (opts.ignoreEngines) {
		args.push('--ignore-engines');
		delete opts.ignoreEngines;
	}

	if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		const userinfo = os.userInfo();
		console.log(`Installing dependencies in ${dir} inside container ${process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME']}...`);

		opts.cwd = root;
		if (process.env['npm_config_arch'] === 'arm64') {
			run('sudo', ['docker', 'run', '--rm', '--privileged', 'multiarch/qemu-user-static', '--reset', '-p', 'yes'], opts);
		}
		run('sudo', ['docker', 'run', '-e', 'GITHUB_TOKEN', '-e', 'npm_config_arch', '-v', `${process.env['VSCODE_HOST_MOUNT']}:/root/vscode`, '-v', `${process.env['VSCODE_HOST_MOUNT']}/.build/.netrc:/root/.netrc`, process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'], 'yarn', '--cwd', dir, ...args], opts);
		run('sudo', ['chown', '-R', `${userinfo.uid}:${userinfo.gid}`, `${dir}/node_modules`], opts);
	} else {
		console.log(`Installing dependencies in ${dir}...`);
		run(yarn, args, opts);
	}
}

for (let dir of dirs) {

	if (dir === '') {
		// `yarn` already executed in root
		continue;
	}

	if (/^.build\/distro\/npm(\/?)/.test(dir)) {
		const ossPath = path.relative('.build/distro/npm', dir);
		const ossYarnRc = path.join(ossPath, '.yarnrc');

		if (fs.existsSync(ossYarnRc)) {
			fs.cpSync(ossYarnRc, path.join(dir, '.yarnrc'));
		}
	}

	if (/^(.build\/distro\/npm\/)?remote/.test(dir) && process.platform === 'win32' && (process.arch === 'arm64' || process.env['npm_config_arch'] === 'arm64')) {
		// windows arm: do not execute `yarn` on remote folder
		continue;
	}

	let opts;

	if (dir === 'build') {
		const env = { ...process.env };
		setupBuildYarnrc();
		opts = { env };
		if (process.env['CC']) { env['CC'] = 'gcc'; }
		if (process.env['CXX']) { env['CXX'] = 'g++'; }
		if (process.env['CXXFLAGS']) { env['CXXFLAGS'] = ''; }
		if (process.env['LDFLAGS']) { env['LDFLAGS'] = ''; }
		yarnInstall('build', opts);
		continue;
	}

	if (/^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		// node modules used by vscode server
		const env = { ...process.env };
		if (process.env['VSCODE_REMOTE_CC']) {
			env['CC'] = process.env['VSCODE_REMOTE_CC'];
		} else {
			delete env['CC'];
		}
		if (process.env['VSCODE_REMOTE_CXX']) {
			env['CXX'] = process.env['VSCODE_REMOTE_CXX'];
		} else {
			delete env['CXX'];
		}
		if (process.env['CXXFLAGS']) { delete env['CXXFLAGS']; }
		if (process.env['CFLAGS']) { delete env['CFLAGS']; }
		if (process.env['LDFLAGS']) { delete env['LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_CXXFLAGS']) { env['CXXFLAGS'] = process.env['VSCODE_REMOTE_CXXFLAGS']; }
		if (process.env['VSCODE_REMOTE_LDFLAGS']) { env['LDFLAGS'] = process.env['VSCODE_REMOTE_LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_NODE_GYP']) { env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }

		opts = { env };
	} else if (/^extensions\//.test(dir)) {
		opts = { ignoreEngines: true };
	}

	yarnInstall(dir, opts);
}

try {
	cp.execSync('git config pull.rebase merges');
	cp.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
} catch (e) {
  console.warn('Skipping git config pull.rebase: not a git repo or submodule');
}