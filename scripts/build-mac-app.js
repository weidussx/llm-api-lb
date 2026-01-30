const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const zlib = require("zlib");

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function rmIfExists(p) {
  if (!(await pathExists(p))) return;
  await fs.rm(p, { recursive: true, force: true });
}

function fail(msg) {
  process.stderr.write(String(msg) + "\n");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) fail(res.error);
  if (typeof res.status === "number" && res.status !== 0) fail(`${cmd} failed`);
  return res;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function solidPng(size, rgba) {
  const w = size;
  const h = size;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const row = Buffer.alloc(1 + w * 4);
  row[0] = 0;
  for (let x = 0; x < w; x += 1) {
    row[1 + x * 4 + 0] = rgba[0];
    row[1 + x * 4 + 1] = rgba[1];
    row[1 + x * 4 + 2] = rgba[2];
    row[1 + x * 4 + 3] = rgba[3];
  }
  const raw = Buffer.alloc(row.length * h);
  for (let y = 0; y < h; y += 1) row.copy(raw, y * row.length);
  const idat = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const distDir = path.join(root, "dist");
  const pkgJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const version = String(pkgJson.version || "0.0.0");

  const binArm64 = path.join(distDir, "llm-api-lb-macos-arm64");
  const binX64 = path.join(distDir, "llm-api-lb-macos-x64");
  if (!(await pathExists(binArm64))) fail(`missing binary: ${binArm64}`);
  if (!(await pathExists(binX64))) fail(`missing binary: ${binX64}`);

  const appName = "llm-api-lb.app";
  const appPath = path.join(distDir, appName);
  const contents = path.join(appPath, "Contents");
  const macosDir = path.join(contents, "MacOS");
  const resourcesDir = path.join(contents, "Resources");

  await rmIfExists(path.join(distDir, ".build-macos-app"));
  await rmIfExists(appPath);
  await fs.mkdir(macosDir, { recursive: true });
  await fs.mkdir(resourcesDir, { recursive: true });
  if (await pathExists(path.join(root, "public"))) {
    await rmIfExists(path.join(resourcesDir, "public"));
    await fs.cp(path.join(root, "public"), path.join(resourcesDir, "public"), { recursive: true });
  }
  if (await pathExists(path.join(root, "assets", "task.png"))) {
    await fs.copyFile(path.join(root, "assets", "task.png"), path.join(resourcesDir, "task.png"));
  }

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>llm-apikey-lb</string>
    <key>CFBundleExecutable</key>
    <string>llm-apikey-lb</string>
    <key>CFBundleIdentifier</key>
    <string>com.weidussx.llm-apikey-lb</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>llm-apikey-lb</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${version}</string>
    <key>CFBundleVersion</key>
    <string>${version}</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSAppTransportSecurity</key>
    <dict>
      <key>NSAllowsArbitraryLoads</key>
      <true/>
    </dict>
  </dict>
</plist>
`;
  await fs.writeFile(path.join(contents, "Info.plist"), infoPlist, "utf8");

  await fs.copyFile(binArm64, path.join(resourcesDir, "llm-apikey-lb-macos-arm64"));
  await fs.copyFile(binX64, path.join(resourcesDir, "llm-apikey-lb-macos-x64"));
  await fs.chmod(path.join(resourcesDir, "llm-apikey-lb-macos-arm64"), 0o755);
  await fs.chmod(path.join(resourcesDir, "llm-apikey-lb-macos-x64"), 0o755);

  const execPath = path.join(macosDir, "llm-apikey-lb");

  const buildDir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-apikey-lb-macos-app-"));
  const swiftPath = path.join(buildDir, "main.swift");

  const swift = `import Cocoa
import WebKit
import Foundation
import Darwin

func machineArch() -> String {
  var u = utsname()
  uname(&u)
  let data = Data(bytes: &u.machine, count: Int(_SYS_NAMELEN))
  let str = String(decoding: data, as: UTF8.self)
  return str.split(separator: "\\0").first.map(String.init) ?? ""
}

func isPortFree(_ port: Int32) -> Bool {
  let sock = socket(AF_INET, SOCK_STREAM, 0)
  if sock < 0 { return false }
  defer { close(sock) }

  var opt: Int32 = 1
  setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &opt, socklen_t(MemoryLayout<Int32>.size))

  var addr = sockaddr_in()
  addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_port = in_port_t(UInt16(port).bigEndian)
  addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

  let bindResult = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { ptr in
      Darwin.bind(sock, ptr, socklen_t(MemoryLayout<sockaddr_in>.size))
    }
  }
  return bindResult == 0
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSWindowDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var portField: NSTextField!
  private var startButton: NSButton!
  private var stopButton: NSButton!
  private var openBrowserButton: NSButton!
  private var statusLabel: NSTextField!
  private var statusItem: NSStatusItem!
  private var menuOpenMain: NSMenuItem!
  private var menuStart: NSMenuItem!
  private var menuStop: NSMenuItem!
  private var menuOpenBrowser: NSMenuItem!
  private var child: Process?
  private var pollingTimer: Timer?
  private var currentURL: URL?
  private var expectedInstanceId: String?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    setupStatusItem()
    buildUI()
    showMainWindow()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationWillTerminate(_ notification: Notification) {
    stopChild()
  }

  private func setupStatusItem() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    if let button = statusItem.button {
      if let url = Bundle.main.url(forResource: "task", withExtension: "png"), let img = NSImage(contentsOf: url) {
        img.isTemplate = true
        img.size = NSSize(width: 18, height: 18)
        button.image = img
      } else {
        if let img = NSApp.applicationIconImage {
          img.isTemplate = true
          img.size = NSSize(width: 18, height: 18)
          button.image = img
        }
      }
    }

    let menu = NSMenu()

    menuOpenMain = NSMenuItem(title: "打开主界面", action: #selector(onMenuOpenMain), keyEquivalent: "")
    menuOpenMain.target = self
    menu.addItem(menuOpenMain)

    menu.addItem(NSMenuItem.separator())

    menuStart = NSMenuItem(title: "启动", action: #selector(onStart), keyEquivalent: "")
    menuStart.target = self
    menu.addItem(menuStart)

    menuStop = NSMenuItem(title: "停止", action: #selector(onStop), keyEquivalent: "")
    menuStop.target = self
    menuStop.isEnabled = false
    menu.addItem(menuStop)

    menuOpenBrowser = NSMenuItem(title: "用浏览器打开", action: #selector(onOpenBrowser), keyEquivalent: "")
    menuOpenBrowser.target = self
    menuOpenBrowser.isEnabled = false
    menu.addItem(menuOpenBrowser)

    menu.addItem(NSMenuItem.separator())

    let quitItem = NSMenuItem(title: "退出", action: #selector(onMenuQuit), keyEquivalent: "q")
    quitItem.target = self
    menu.addItem(quitItem)

    statusItem.menu = menu
  }

  private func showMainWindow() {
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  @objc private func onMenuOpenMain() {
    showMainWindow()
  }

  @objc private func onMenuQuit() {
    stopChild()
    NSApp.terminate(nil)
  }

  private func buildUI() {
    let rect = NSRect(x: 0, y: 0, width: 1100, height: 740)
    window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "llm-api-lb"
    window.center()
    window.isReleasedWhenClosed = false
    window.delegate = self

    let content = NSView()
    content.translatesAutoresizingMaskIntoConstraints = false
    window.contentView = content

    let topBar = NSStackView()
    topBar.orientation = .horizontal
    topBar.spacing = 10
    topBar.alignment = .centerY
    topBar.translatesAutoresizingMaskIntoConstraints = false

    let portLabel = NSTextField(labelWithString: "端口")
    portLabel.textColor = .secondaryLabelColor

    portField = NSTextField(string: "8787")
    portField.controlSize = .regular
    portField.font = NSFont.systemFont(ofSize: 13)
    portField.translatesAutoresizingMaskIntoConstraints = false
    portField.widthAnchor.constraint(equalToConstant: 120).isActive = true

    startButton = NSButton(title: "启动", target: self, action: #selector(onStart))
    startButton.bezelStyle = .rounded
    startButton.keyEquivalent = "\\r"

    stopButton = NSButton(title: "停止", target: self, action: #selector(onStop))
    stopButton.bezelStyle = .rounded
    stopButton.isEnabled = false

    openBrowserButton = NSButton(title: "用浏览器打开", target: self, action: #selector(onOpenBrowser))
    openBrowserButton.bezelStyle = .rounded
    openBrowserButton.isEnabled = false

    statusLabel = NSTextField(labelWithString: "")
    statusLabel.textColor = .secondaryLabelColor
    statusLabel.lineBreakMode = .byTruncatingMiddle

    topBar.addArrangedSubview(portLabel)
    topBar.addArrangedSubview(portField)
    topBar.addArrangedSubview(startButton)
    topBar.addArrangedSubview(stopButton)
    topBar.addArrangedSubview(openBrowserButton)
    topBar.addArrangedSubview(statusLabel)

    let config = WKWebViewConfiguration()
    webView = WKWebView(frame: .zero, configuration: config)
    webView.translatesAutoresizingMaskIntoConstraints = false
    webView.navigationDelegate = self

    content.addSubview(topBar)
    content.addSubview(webView)

    NSLayoutConstraint.activate([
      topBar.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
      topBar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
      topBar.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),

      webView.topAnchor.constraint(equalTo: topBar.bottomAnchor, constant: 12),
      webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      webView.bottomAnchor.constraint(equalTo: content.bottomAnchor)
    ])

    let placeholder = URL(string: "about:blank")!
    webView.load(URLRequest(url: placeholder))
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    sender.orderOut(nil)
    return false
  }

  @objc private func onOpenBrowser() {
    guard let url = currentURL else { return }
    NSWorkspace.shared.open(url)
  }

  @objc private func onStop() {
    stopChild()
    let placeholder = URL(string: "about:blank")!
    webView.load(URLRequest(url: placeholder))
    statusLabel.stringValue = "已停止"
  }

  @objc private func onStart() {
    let trimmed = portField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let port = Int32(trimmed) ?? 8787
    if port < 1 || port > 65535 {
      statusLabel.stringValue = "端口无效，请输入 1-65535"
      return
    }
    if !isPortFree(port) {
      statusLabel.stringValue = "端口已被占用，请换一个"
      return
    }

    stopChild()

    guard let res = Bundle.main.resourceURL else {
      statusLabel.stringValue = "Resources 不存在"
      return
    }

    let arch = machineArch()
    let binName = (arch == "x86_64") ? "llm-apikey-lb-macos-x64" : "llm-apikey-lb-macos-arm64"
    let binURL = res.appendingPathComponent(binName)

    let proc = Process()
    proc.executableURL = binURL
    let fm = FileManager.default
    let appSupportBase = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let appSupportDir = appSupportBase.appendingPathComponent("llm-api-lb", isDirectory: true)
    try? fm.createDirectory(at: appSupportDir, withIntermediateDirectories: true)
    var env = ProcessInfo.processInfo.environment
    let instanceId = UUID().uuidString
    env["PORT"] = String(port)
    env["LAUNCHER_MODE"] = "0"
    env["AUTO_OPEN_BROWSER"] = "0"
    env["DATA_FILE"] = appSupportDir.appendingPathComponent("state.json").path
    env["LLM_API_LB_INSTANCE_ID"] = instanceId
    proc.currentDirectoryURL = appSupportDir
    proc.environment = env
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice

    do {
      try proc.run()
      child = proc
    } catch {
      statusLabel.stringValue = "启动失败：\\(error.localizedDescription)"
      return
    }

    let url = URL(string: "http://localhost:\\(port)/")!
    currentURL = url
    expectedInstanceId = instanceId
    openBrowserButton.isEnabled = true
    stopButton.isEnabled = true
    menuOpenBrowser.isEnabled = true
    menuStop.isEnabled = true
    menuStart.isEnabled = false
    statusLabel.stringValue = "正在启动…"
    startPollingHealth(url)
  }

  private func stopChild() {
    pollingTimer?.invalidate()
    pollingTimer = nil
    currentURL = nil
    expectedInstanceId = nil
    openBrowserButton.isEnabled = false
    stopButton.isEnabled = false
    if menuOpenBrowser != nil { menuOpenBrowser.isEnabled = false }
    if menuStop != nil { menuStop.isEnabled = false }
    if menuStart != nil { menuStart.isEnabled = true }
    if let p = child {
      if p.isRunning { p.terminate() }
      child = nil
    }
  }

  private func startPollingHealth(_ base: URL) {
    pollingTimer?.invalidate()
    let health = base.appendingPathComponent("health")
    let startedAt = Date()
    pollingTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] t in
      guard let self else { return }
      if Date().timeIntervalSince(startedAt) > 6.0 {
        DispatchQueue.main.async {
          t.invalidate()
          self.statusLabel.stringValue = "启动超时：端口可能被占用（尤其是 IPv6/旧实例）"
        }
        return
      }
      var req = URLRequest(url: health)
      req.cachePolicy = .reloadIgnoringLocalCacheData
      URLSession.shared.dataTask(with: req) { data, resp, err in
        if err != nil { return }
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200, let data else { return }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let got = obj["instanceId"] as? String,
           let expected = self.expectedInstanceId,
           got == expected {
          DispatchQueue.main.async {
            t.invalidate()
            self.statusLabel.stringValue = "已启动：\\(base.absoluteString)"
            self.webView.load(URLRequest(url: base))
          }
        }
      }.resume()
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
`;

  await fs.writeFile(swiftPath, swift, "utf8");
  try {
    const iconPng = path.join(buildDir, "icon-1024.png");
    const iconSrc = path.join(root, "assets", "icon.png");
    if (await pathExists(iconSrc)) {
      await fs.copyFile(iconSrc, iconPng);
    } else {
      await fs.writeFile(iconPng, solidPng(1024, [37, 99, 235, 255]));
    }
    const iconsetDir = path.join(buildDir, "AppIcon.iconset");
    await fs.mkdir(iconsetDir, { recursive: true });
    const sizes = [
      [16, "icon_16x16.png"],
      [32, "icon_16x16@2x.png"],
      [32, "icon_32x32.png"],
      [64, "icon_32x32@2x.png"],
      [128, "icon_128x128.png"],
      [256, "icon_128x128@2x.png"],
      [256, "icon_256x256.png"],
      [512, "icon_256x256@2x.png"],
      [512, "icon_512x512.png"],
      [1024, "icon_512x512@2x.png"]
    ];
    for (const [px, name] of sizes) {
      run("sips", ["-z", String(px), String(px), iconPng, "--out", path.join(iconsetDir, name)]);
    }
    run("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(resourcesDir, "AppIcon.icns")]);

    const armOut = path.join(buildDir, "llm-apikey-lb-arm64");
    const x64Out = path.join(buildDir, "llm-apikey-lb-x86_64");
    run("xcrun", [
      "swiftc",
      "-O",
      swiftPath,
      "-o",
      armOut,
      "-target",
      "arm64-apple-macos11.0",
      "-framework",
      "Cocoa",
      "-framework",
      "WebKit"
    ]);
    run("xcrun", [
      "swiftc",
      "-O",
      swiftPath,
      "-o",
      x64Out,
      "-target",
      "x86_64-apple-macos11.0",
      "-framework",
      "Cocoa",
      "-framework",
      "WebKit"
    ]);
    run("xcrun", ["lipo", "-create", "-output", execPath, armOut, x64Out]);
  } finally {
    await rmIfExists(buildDir);
  }
  await fs.chmod(execPath, 0o755);

  if (process.platform === "darwin") {
    const zipPath = path.join(distDir, "llm-apikey-lb-macos.app.zip");
    await rmIfExists(zipPath);
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);
  }

  process.stdout.write(`created ${appPath}\n`);
}

main().catch((e) => fail(e && e.stack ? e.stack : e));
