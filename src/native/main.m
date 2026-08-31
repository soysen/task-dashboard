#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <unistd.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler>
@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) WKWebView *webView;
@property (strong, nonatomic) NSTask *serverTask;
@property (strong, nonatomic) NSFileHandle *logFileHandle;
@property (assign, nonatomic) BOOL isTerminating;
@end

@implementation AppDelegate

- (NSString *)findNodeBinary {
    NSString *homeDir = NSHomeDirectory();
    NSArray *candidates = @[[homeDir stringByAppendingPathComponent:@".local/bin/node"],
        @"/opt/homebrew/bin/node",
        @"/usr/local/bin/node",
        @"/usr/bin/node"
    ];
    for (NSString *candidate in candidates) {
        if ([[NSFileManager defaultManager] isExecutableFileAtPath:candidate]) {
            return candidate;
        }
    }
    // 檢查 ~/.nvm/versions/node
    NSString *nvmDir = [homeDir stringByAppendingPathComponent:@".nvm/versions/node"];
    if ([[NSFileManager defaultManager] fileExistsAtPath:nvmDir]) {
        NSArray *versions = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:nvmDir error:nil];
        if (versions && versions.count > 0) {
            for (NSString *ver in [versions reverseObjectEnumerator]) {
                NSString *nvmNode = [nvmDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@/bin/node", ver]];
                if ([[NSFileManager defaultManager] isExecutableFileAtPath:nvmNode]) {
                    return nvmNode;
                }
            }
        }
    }
    return @"node";
}

- (NSString *)findServerScript {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *homeDir = NSHomeDirectory();

    // 1. 環境變數優先覆寫
    NSString *envScript = [[[NSProcessInfo processInfo] environment] objectForKey:@"TASK_DASHBOARD_SERVER_SCRIPT"];
    if (envScript && [fm fileExistsAtPath:envScript]) {
        return envScript;
    }

    // 2. 檢查目前 App 執行檔向上尋找專案根目錄 (適用於本機開發與 dist/ 目錄)
    NSString *bundlePath = [[NSBundle mainBundle] bundlePath];
    NSString *parentOfBundle = [bundlePath stringByDeletingLastPathComponent];
    NSString *projectFromBundle = [parentOfBundle stringByDeletingLastPathComponent];
    NSString *candidateFromParent = [projectFromBundle stringByAppendingPathComponent:@"src/server/server.js"];
    if ([fm fileExistsAtPath:candidateFromParent]) {
        return candidateFromParent;
    }

    // 3. 預設標準目錄 ~/projects/task-dashboard
    NSString *defaultCanonical = [homeDir stringByAppendingPathComponent:@"projects/task-dashboard/src/server/server.js"];
    if ([fm fileExistsAtPath:defaultCanonical]) {
        return defaultCanonical;
    }

    // 4. 動態搜尋 ~/projects/ 底下符合 task-dashboard 的專案目錄
    NSString *projectsDir = [homeDir stringByAppendingPathComponent:@"projects"];
    NSError *error = nil;
    NSArray<NSString *> *items = [fm contentsOfDirectoryAtPath:projectsDir error:&error];
    if (!error && items) {
        for (NSString *item in items) {
            if ([item hasPrefix:@"."]) continue;
            NSString *candidateDir = [projectsDir stringByAppendingPathComponent:item];
            NSString *candidateScript = [candidateDir stringByAppendingPathComponent:@"src/server/server.js"];
            if ([fm fileExistsAtPath:candidateScript]) {
                NSString *pkgPath = [candidateDir stringByAppendingPathComponent:@"package.json"];
                if ([fm fileExistsAtPath:pkgPath]) {
                    NSData *pkgData = [NSData dataWithContentsOfFile:pkgPath];
                    if (pkgData) {
                        NSDictionary *json = [NSJSONSerialization JSONObjectWithData:pkgData options:0 error:nil];
                        if (json && [json[@"name"] isEqualToString:@"task-dashboard"]) {
                            return candidateScript;
                        }
                    }
                }
            }
        }
        for (NSString *item in items) {
            if ([item hasPrefix:@"."]) continue;
            NSString *candidateScript = [projectsDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@/src/server/server.js", item]];
            if ([fm fileExistsAtPath:candidateScript]) {
                return candidateScript;
            }
        }
    }

    // 5. 獨立 App Bundle 內建資源 fallback
    NSString *resourcePath = [[NSBundle mainBundle] resourcePath];
    NSString *bundledScript = [resourcePath stringByAppendingPathComponent:@"web/src/server/server.js"];
    if ([fm fileExistsAtPath:bundledScript]) {
        return bundledScript;
    }

    return defaultCanonical;
}

- (void)startServerIfNeeded {
    if (self.isTerminating) return;

    FILE *fp = popen("/usr/sbin/lsof -ti:3030", "r");
    char buf[128];
    if (fp) {
        if (fgets(buf, sizeof(buf), fp) != NULL) {
            pclose(fp);
            NSLog(@"[TaskDashboard] 伺服器埠口 3030 已在運行中");
            return;
        }
        pclose(fp);
    }

    NSString *homeDir = NSHomeDirectory();
    NSString *nodeBin = [self findNodeBinary];
    NSLog(@"[TaskDashboard] 使用 Node.js 執行檔: %@", nodeBin);

    // 動態定位伺服器入口 (支援專案資料夾更名與獨立 Bundle)
    NSString *canonicalServerScript = [self findServerScript];
    NSLog(@"[TaskDashboard] 使用伺服器腳本: %@", canonicalServerScript);

    self.serverTask = [[NSTask alloc] init];
    self.serverTask.launchPath = nodeBin;
    self.serverTask.arguments = @[canonicalServerScript];

    NSMutableDictionary *env = [NSMutableDictionary dictionaryWithDictionary:[[NSProcessInfo processInfo] environment]];
    NSString *extraPaths = [NSString stringWithFormat:@"%@/.local/bin:%@/.nvm/versions/node/v20.18.3/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", homeDir, homeDir];
    NSString *existingPath = env[@"PATH"] ?: @"/usr/bin:/bin:/usr/sbin:/sbin";
    env[@"PATH"] = [NSString stringWithFormat:@"%@:%@", extraPaths, existingPath];
    self.serverTask.environment = env;
    self.serverTask.currentDirectoryPath = [canonicalServerScript stringByDeletingLastPathComponent];

    NSString *logPath = @"/tmp/task_dashboard_server.log";
    [[NSFileManager defaultManager] createFileAtPath:logPath contents:nil attributes:nil];
    self.logFileHandle = [NSFileHandle fileHandleForWritingAtPath:logPath];
    if (self.logFileHandle) {
        self.serverTask.standardOutput = self.logFileHandle;
        self.serverTask.standardError = self.logFileHandle;
    } else {
        self.serverTask.standardOutput = [NSFileHandle fileHandleWithNullDevice];
        self.serverTask.standardError = [NSFileHandle fileHandleWithNullDevice];
    }

    __weak typeof(self) weakSelf = self;
    self.serverTask.terminationHandler = ^(NSTask *task) {
        if (!weakSelf.isTerminating) {
            NSLog(@"[TaskDashboard]  偵測到 Node 伺服器異常退出 (狀態碼: %d)，守護行程將自動重啟...", [task terminationStatus]);
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                if (!weakSelf.isTerminating) {
                    [weakSelf startServerIfNeeded];
                }
            });
        }
    };

    @try {
        [self.serverTask launch];
        NSLog(@"[TaskDashboard] 已啟動 Node 伺服器 (PID: %d)，日誌寫入 %@", [self.serverTask processIdentifier], logPath);
    } @catch (NSException *exception) {
        NSLog(@"[TaskDashboard] 伺服器啟動失敗: %@", exception.reason);
    }

    for (int i = 0; i < 30; i++) {
        usleep(150000);
        FILE *checkFp = popen("/usr/sbin/lsof -ti:3030", "r");
        if (checkFp) {
            if (fgets(buf, sizeof(buf), checkFp) != NULL) {
                pclose(checkFp);
                break;
            }
            pclose(checkFp);
        }
    }
}

- (void)stopServerCleanly {
    self.isTerminating = YES;
    NSLog(@"[TaskDashboard] 正在關閉 Node 伺服器與釋放埠口 3030...");
    if (self.serverTask && [self.serverTask isRunning]) {
        self.serverTask.terminationHandler = nil;
        [self.serverTask terminate];
        [self.serverTask waitUntilExit];
        self.serverTask = nil;
    }
    if (self.logFileHandle) {
        [self.logFileHandle closeFile];
        self.logFileHandle = nil;
    }
    system("/usr/sbin/lsof -ti:3030 | /usr/bin/xargs /bin/kill -9 > /dev/null 2>&1");
    system("/usr/bin/pkill -f 'src/server/server.js' > /dev/null 2>&1");
    NSLog(@"[TaskDashboard] 伺服器已完全關閉！");
}

- (void)restartServerAndReload {
    NSLog(@"[TaskDashboard] 執行一鍵重啟 Node 伺服器並重新整理...");
    if (self.serverTask && [self.serverTask isRunning]) {
        self.serverTask.terminationHandler = nil;
        [self.serverTask terminate];
        [self.serverTask waitUntilExit];
        self.serverTask = nil;
    }
    system("/usr/sbin/lsof -ti:3030 | /usr/bin/xargs /bin/kill -9 > /dev/null 2>&1");
    system("/usr/bin/pkill -f 'src/server/server.js' > /dev/null 2>&1");

    [self startServerIfNeeded];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(600 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        NSURL *url = [NSURL URLWithString:@"http://localhost:3030"];
        NSURLRequest *request = [NSURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:10.0];
        [self.webView loadRequest:request];
    });
}

- (void)userContentController:(WKUserContentController *)userContentController didReceiveScriptMessage:(WKScriptMessage *)message {
    if ([message.name isEqualToString:@"dragWindow"]) {
        NSEvent *currentEvent = [NSApp currentEvent];
        [self.window performWindowDragWithEvent:currentEvent];
    } else if ([message.name isEqualToString:@"zoomWindow"]) {
        [self.window performZoom:nil];
    } else if ([message.name isEqualToString:@"restartServer"]) {
        [self restartServerAndReload];
    }
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"[TaskDashboard] 載入重試中... 原因: %@", error.localizedDescription);
    [self startServerIfNeeded];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(500 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        NSURL *url = [NSURL URLWithString:@"http://localhost:3030"];
        [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
    });
}

// 支援 JavaScript window.confirm 原生對話框
- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL result))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"確認操作";
    alert.informativeText = message;
    [alert addButtonWithTitle:@"確定"];
    [alert addButtonWithTitle:@"取消"];
    alert.alertStyle = NSAlertStyleWarning;

    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse returnCode) {
        completionHandler(returnCode == NSAlertFirstButtonReturn);
    }];
}

// 支援 JavaScript window.alert 原生對話框
- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"提示";
    alert.informativeText = message;
    [alert addButtonWithTitle:@"好"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse returnCode) {
        completionHandler();
    }];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self setupMainMenu];
    [self startServerIfNeeded];

    NSRect frame = NSMakeRect(0, 0, 1340, 880);
    NSUInteger styleMask = NSWindowStyleMaskTitled |
                           NSWindowStyleMaskClosable |
                           NSWindowStyleMaskMiniaturizable |
                           NSWindowStyleMaskResizable |
                           NSWindowStyleMaskFullSizeContentView;

    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:styleMask
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];

    self.window.title = @"Task Dashboard";
    self.window.titlebarAppearsTransparent = YES;
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:0.04 green:0.06 blue:0.10 alpha:1.0];
    [self.window center];
    [self.window setFrameAutosaveName:@"TaskDashboardMainWindowV10"];
    self.window.delegate = self;
    [self.window setMovableByWindowBackground:YES];

    WKUserContentController *userContentController = [[WKUserContentController alloc] init];
    [userContentController addScriptMessageHandler:self name:@"dragWindow"];
    [userContentController addScriptMessageHandler:self name:@"zoomWindow"];
    [userContentController addScriptMessageHandler:self name:@"restartServer"];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.userContentController = userContentController;
    // 停用快取
    config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];

    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    [self.webView setValue:@(NO) forKey:@"drawsBackground"];

    [self.window.contentView addSubview:self.webView];

    NSURL *url = [NSURL URLWithString:@"http://localhost:3030"];
    NSURLRequest *request = [NSURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:10.0];
    [self.webView loadRequest:request];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)setupMainMenu {
    NSMenu *menubar = [[NSMenu alloc] init];

    // App Menu
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] init];
    [appMenu addItemWithTitle:@"重新整理 (Reload)" action:@selector(reloadPage) keyEquivalent:@"r"];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"隱藏 Task Dashboard" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"結束 Task Dashboard" action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];

    // Edit Menu
    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];

    [editMenuItem setSubmenu:editMenu];

    [NSApp setMainMenu:menubar];
}

- (void)reloadPage {
    [self.webView reloadFromOrigin];
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    [self stopServerCleanly];
    return YES;
}

- (void)windowWillClose:(NSNotification *)notification {
    [self stopServerCleanly];
    [NSApp terminate:nil];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    [self stopServerCleanly];
}

@end

static AppDelegate *gAppDelegate = nil;

void handleSignal(int sig) {
    if (gAppDelegate) {
        [gAppDelegate stopServerCleanly];
    }
    exit(0);
}

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        signal(SIGINT, handleSignal);
        signal(SIGTERM, handleSignal);
        signal(SIGHUP, handleSignal);

        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        gAppDelegate = delegate;
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
