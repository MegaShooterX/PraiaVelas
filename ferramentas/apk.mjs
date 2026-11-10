// Builds the app for Android: an APK signed with the key of this computer, ready to install on a phone.
//
//   npm run apk          (or: node ferramentas/apk.mjs)
//
// The same path as PraiaPuzzle's. Everything that is built stays out of the Google Drive: the Capacitor project
// and its packages in `D:\tools\deps\PraiaVelas` (PRAIAVELAS_DEPS changes it), every APK in
// `D:\Projetos\PraiaVelas\dist` (PRAIAVELAS_SAIDA). In the Drive stay only the app (`app/`), the config of the
// Android app (`celular/`), this script, and one APK: the last one, `PraiaVelas.apk` in the project's folder, for
// Rhuan to install from the phone (asked by him on 09/11/2026). It is overwritten at each build.
//
// The key is kept outside the project, in %APPDATA%\PraiaVelas\android: an APK installs over the one before only
// when signed with the same key, so it is made once and kept. Keep a copy of that folder.
//
// On the phone the app reads Yahoo and the Central Bank through the phone's own HTTP (CapacitorHttp, see
// app/motor/rede.js): no proxy, no CORS. No Python here (the project's rule): the icon is an Android vector.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const deps = process.env.PRAIAVELAS_DEPS ?? 'D:\\tools\\deps\\PraiaVelas';
const saida = process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas';
const android = join(deps, 'android');
const windows = process.platform === 'win32';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(root, 'celular', 'capacitor.config.json'), 'utf8'));
const id = config.appId;

/** The packages the Android app is made with, at the versions this computer's JDK 17 builds (as PraiaPuzzle). */
const DEPENDENCIES = {
	name: 'praiavelas-deps',
	private: true,
	description: 'Dependências do PraiaVelas (fora do Google Drive). O projeto fica em H:/Meu Drive/Projetos/PraiaVelas.',
	dependencies: {
		'@capacitor/android': '6.2.1',
		'@capacitor/app': '6.0.3',
		'@capacitor/core': '6.2.1'
	},
	devDependencies: { '@capacitor/cli': '6.2.1' }
};

function run(command, args, options = {}) {
	const said = spawnSync(command, args, { stdio: 'inherit', shell: windows, ...options });
	// Said without its arguments: the password of the key is among them.
	if (said.status !== 0) throw new Error(`${command} falhou`);
}

/** Changes a text file only where it still lacks what it needs, so running again changes nothing. */
function patch(file, edits) {
	let text = readFileSync(file, 'utf8');
	for (const [mark, from, to] of edits) if (!text.includes(mark)) text = text.replace(from, to);
	writeFileSync(file, text);
}

function signingKey() {
	const folder = join(process.env.APPDATA ?? homedir(), 'PraiaVelas', 'android');
	const store = join(folder, 'praiavelas.keystore');
	const secret = join(folder, 'senha.txt');
	if (existsSync(store) && existsSync(secret)) return { store, password: readFileSync(secret, 'utf8').trim() };
	mkdirSync(folder, { recursive: true });
	const password = randomBytes(18).toString('base64url');
	const keytool = join(process.env.JAVA_HOME ?? '', 'bin', windows ? 'keytool.exe' : 'keytool');
	run(existsSync(keytool) ? keytool : 'keytool', [
		'-genkeypair', '-noprompt', '-keystore', store, '-alias', 'praiavelas', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '18250',
		'-storepass', password, '-keypass', password, '-dname', 'CN=PraiaVelas, O=Praia Mar, C=BR'
	], { shell: false });
	writeFileSync(secret, password);
	console.log(`Chave do app criada em ${folder}: guarde esta pasta. Sem ela, um APK novo não instala por cima do antigo.`);
	return { store, password };
}

/** The icon: three candles (up, down, up) on the app's dark blue, as an adaptive vector icon (Android 8+). */
function icon(res) {
	mkdirSync(join(res, 'drawable'), { recursive: true });
	mkdirSync(join(res, 'mipmap-anydpi-v26'), { recursive: true });
	writeFileSync(
		join(res, 'drawable', 'ic_praiavelas.xml'),
		`<?xml version="1.0" encoding="utf-8"?>
<!-- PraiaVelas icon, made by ferramentas/apk.mjs: three candles inside the 72dp safe zone of a 108dp icon. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#22C55E" android:pathData="M38,40h10v26h-10z"/>
    <path android:fillColor="#22C55E" android:pathData="M42,32h2v42h-2z"/>
    <path android:fillColor="#EF4444" android:pathData="M49,48h10v18h-10z"/>
    <path android:fillColor="#EF4444" android:pathData="M53,42h2v32h-2z"/>
    <path android:fillColor="#22C55E" android:pathData="M60,34h10v22h-10z"/>
    <path android:fillColor="#22C55E" android:pathData="M64,28h2v34h-2z"/>
    <path android:fillColor="#38BDF8" android:pathData="M30,78c8,-5 16,5 24,0s16,5 24,0v3c-8,5 -16,-5 -24,0s-16,-5 -24,0z"/>
</vector>
`
	);
	const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_praiavelas_fundo"/>
    <foreground android:drawable="@drawable/ic_praiavelas"/>
</adaptive-icon>
`;
	writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
	writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
	mkdirSync(join(res, 'values'), { recursive: true });
	writeFileSync(join(res, 'values', 'ic_praiavelas.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_praiavelas_fundo">#0B1220</color>\n</resources>\n');
}

try {
	const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
	if (!sdk || !existsSync(join(sdk, 'platforms'))) throw new Error('Android SDK não encontrado (ANDROID_HOME).');
	if (!process.env.JAVA_HOME) throw new Error('JAVA_HOME não definido (precisa do JDK 17).');
	if (/\s|[^ -~]/.test(deps)) throw new Error(`A pasta de montagem não pode ter espaço nem acento: ${deps}`);

	// 1. The packages, out of the Drive.
	mkdirSync(deps, { recursive: true });
	writeFileSync(join(deps, 'package.json'), `${JSON.stringify(DEPENDENCIES, null, '\t')}\n`);
	if (!existsSync(join(deps, 'node_modules', '@capacitor', 'android'))) run('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: deps });
	writeFileSync(join(deps, 'capacitor.config.json'), `${JSON.stringify(config, null, '\t')}\n`);

	// 2. The app as it is now (app/ is exactly what goes in: no build step).
	const www = join(deps, 'www');
	rmSync(www, { recursive: true, force: true });
	cpSync(join(root, 'app'), www, { recursive: true });
	// A draft (changes with no number yet, Rhuan 09/11/2026) is the last number with "+", and its file carries the
	// date, so it never takes the place of the APK of a numbered version.
	const draft = /ENGINE_DRAFT = true/.test(readFileSync(join(root, 'app', 'motor', 'analise.js'), 'utf8'));
	const version = draft ? `${pkg.version}+` : pkg.version;
	// Local time, as on the computer's clock.
	const now = new Date();
	const two = (n) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;

	// 3. The Android project, made once, then set up: portrait, signed, with its icon.
	if (!existsSync(android)) run('npx', ['cap', 'add', 'android'], { cwd: deps });
	writeFileSync(join(android, 'local.properties'), `sdk.dir=${sdk.split('\\').join('\\\\')}\n`);
	patch(join(android, 'app', 'build.gradle'), [
		['praiavelasVersionCode', /versionCode 1\s*\n\s*versionName "1.0"/, `// Given by ferramentas/apk.mjs: each APK newer than the one before, for it to install over it.\n        versionCode((project.findProperty('praiavelasVersionCode') ?: '1') as Integer)\n        versionName(project.findProperty('praiavelasVersionName') ?: '0.0.1')`],
		['praiavelasKeystore', /    buildTypes \{\n        release \{\n/, `    // Signed with the key kept on the computer that builds it (see ferramentas/apk.mjs), never in the project.\n    signingConfigs {\n        release {\n            if (project.hasProperty('praiavelasKeystore')) {\n                storeFile file(project.property('praiavelasKeystore'))\n                storePassword project.property('praiavelasPassword')\n                keyAlias 'praiavelas'\n                keyPassword project.property('praiavelasPassword')\n            }\n        }\n    }\n    buildTypes {\n        release {\n            if (project.hasProperty('praiavelasKeystore')) signingConfig signingConfigs.release\n`]
	]);
	patch(join(android, 'app', 'src', 'main', 'AndroidManifest.xml'), [['screenOrientation', 'android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"']]);
	icon(join(android, 'app', 'src', 'main', 'res'));

	run('npx', ['cap', 'sync', 'android'], { cwd: deps });

	// 4. Gradle, run by Java itself: no shell in the way.
	const key = signingKey();
	const code = Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 60_000);
	const java = join(process.env.JAVA_HOME, 'bin', windows ? 'java.exe' : 'java');
	run(java, [
		'-classpath', join(android, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain',
		'assembleRelease', '--no-daemon', '-q',
		`-PpraiavelasKeystore=${key.store}`, `-PpraiavelasPassword=${key.password}`,
		`-PpraiavelasVersionCode=${code}`, `-PpraiavelasVersionName=${version}`
	], { cwd: android, shell: false });

	const made = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
	const dist = join(saida, 'dist');
	mkdirSync(dist, { recursive: true });
	const apk = join(dist, draft ? `PraiaVelas-${pkg.version}-rascunho-${stamp}.apk` : `PraiaVelas-${version}.apk`);
	copyFileSync(made, apk);
	// The one to install from the phone: in the Drive, always the last.
	const toInstall = join(root, 'PraiaVelas.apk');
	copyFileSync(made, toInstall);
	console.log(`APK: ${apk} (${(statSync(apk).size / 1048576).toFixed(1)} MB, versão ${version}, código ${code})`);
	console.log(`Para instalar pelo celular: ${toInstall}`);
} catch (error) {
	console.error(String(error?.message ?? error));
	process.exit(1);
}
