#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <UserNotifications/UserNotifications.h>
#import <unistd.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate>
@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) WKWebView *webView;
@property (strong, nonatomic) NSTask *serverTask;
@property (strong, nonatomic) NSFileHandle *logFileHandle;
@property (assign, nonatomic) BOOL isTerminating;
@end

@implementation AppDelegate

static BOOL isWorkingNodeBinary(NSString *path) {
    if (!path || path.length == 0) return NO;
    if (![[NSFileManager defaultManager] isExecutableFileAtPath:path]) return NO;
    
    // 實機驗證 node 執行檔是否可正常運行 (防止架構不相容或損毀之 binary)
    char cmd[1024];
    snprintf(cmd, sizeof(cmd), "\"%s\" -v > /dev/null 2>&1", [path UTF8String]);
    int status = system(cmd);
    return (status == 0);
}

- (NSString *)findNodeBinary {
    NSString *homeDir = NSHomeDirectory();

    // 1. 優先查詢使用者登入 Shell (zsh/bash) 作用中之 node 路徑
    FILE *pipe = popen("/bin/zsh -l -c 'which node' 2>/dev/null", "r");
    if (pipe) {
        char buf[512];
        if (fgets(buf, sizeof(buf), pipe) != NULL) {
            pclose(pipe);
            NSString *shellNode = [[NSString stringWithUTF8String:buf] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (isWorkingNodeBinary(shellNode)) {
                return shellNode;
            }
        } else {
            pclose(pipe);
        }
    }

    // 2. 檢查已知靜態與套件管理工具路徑
    NSArray *candidates = @[
        @"/opt/homebrew/bin/node",
        @"/usr/local/bin/node",
        [homeDir stringByAppendingPathComponent:@".local/bin/node"],
        [homeDir stringByAppendingPathComponent:@".volta/bin/node"],
        [homeDir stringByAppendingPathComponent:@".asdf/shims/node"],
        [homeDir stringByAppendingPathComponent:@".local/share/mise/shims/node"],
        [homeDir stringByAppendingPathComponent:@".fnm/current/bin/node"],
        @"/usr/bin/node"
    ];
    for (NSString *candidate in candidates) {
        if (isWorkingNodeBinary(candidate)) {
            return candidate;
        }
    }

    // 3. 搜尋 ~/.nvm/versions/node，使用正規數值版本號遞減排序 (例如 v24 > v22 > v14) 並實機驗證可執行性
    NSString *nvmDir = [homeDir stringByAppendingPathComponent:@".nvm/versions/node"];
    if ([[NSFileManager defaultManager] fileExistsAtPath:nvmDir]) {
        NSArray *versions = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:nvmDir error:nil];
        if (versions && versions.count > 0) {
            NSArray *sortedVersions = [versions sortedArrayUsingComparator:^NSComparisonResult(NSString *a, NSString *b) {
                return [b compare:a options:NSNumericSearch];
            }];
            for (NSString *ver in sortedVersions) {
                NSString *nvmNode = [nvmDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@/bin/node", ver]];
                if (isWorkingNodeBinary(nvmNode)) {
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
    NSString *nodeDir = [nodeBin stringByDeletingLastPathComponent];
    NSString *extraPaths = [NSString stringWithFormat:@"%@:%@/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", nodeDir, homeDir];
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
    } else if ([message.name isEqualToString:@"openExternalUrl"]) {
        if ([message.body isKindOfClass:[NSString class]]) {
            NSURL *url = [NSURL URLWithString:message.body];
            if (url) {
                [[NSWorkspace sharedWorkspace] openURL:url];
            }
        }
    } else if ([message.name isEqualToString:@"updateDockBadge"]) {
        NSInteger count = 0;
        if ([message.body isKindOfClass:[NSDictionary class]]) {
            count = [message.body[@"count"] integerValue];
        } else if ([message.body isKindOfClass:[NSNumber class]]) {
            count = [message.body integerValue];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            NSDockTile *tile = [NSApp dockTile];
            [tile setBadgeLabel:(count > 0 ? [NSString stringWithFormat:@"%ld", (long)count] : nil)];
            [tile display];
        });
    } else if ([message.name isEqualToString:@"notifyUserAttention"]) {
        NSString *taskId = @"";
        NSString *title = @"任務需要您的確認";
        NSString *body = @"請點擊開啟 Task Dashboard 確認內容";
        if ([message.body isKindOfClass:[NSDictionary class]]) {
            if ([message.body[@"taskId"] isKindOfClass:[NSString class]]) taskId = message.body[@"taskId"];
            if ([message.body[@"title"] isKindOfClass:[NSString class]] && [message.body[@"title"] length] > 0) title = message.body[@"title"];
            if ([message.body[@"body"] isKindOfClass:[NSString class]] && [message.body[@"body"] length] > 0) body = message.body[@"body"];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            if (![NSApp isActive]) {
                [NSApp requestUserAttention:NSInformationalRequest];
            }
            [self postLocalNotificationWithTaskId:taskId title:title body:body];
        });
    }
}

- (BOOL)canUseUserNotifications {
    NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier];
    return (bundleId != nil && bundleId.length > 0);
}

- (void)setupUserNotifications {
    if (![self canUseUserNotifications]) return;
    @try {
        UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
        center.delegate = self;
        [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                              completionHandler:^(BOOL granted, NSError * _Nullable error) {
            if (error) {
                NSLog(@"[TaskDashboard] 通知權限請求錯誤: %@", error.localizedDescription);
            }
        }];
    } @catch (NSException *exception) {
        NSLog(@"[TaskDashboard] 初始化通知中心失敗: %@", exception.reason);
    }
}

- (void)postLocalNotificationWithTaskId:(NSString *)taskId title:(NSString *)title body:(NSString *)body {
    if (![self canUseUserNotifications]) return;
    @try {
        UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
        content.title = title ?: @"任務需要您的確認";
        content.body = body ?: @"請開啟 Task Dashboard 確認內容";
        content.sound = [UNNotificationSound defaultSound];
        content.userInfo = @{ @"taskId": taskId ?: @"" };

        NSString *identifier = [NSString stringWithFormat:@"td-attention-%@-%llu",
                                (taskId.length > 0 ? taskId : @"task"),
                                (unsigned long long)([[NSDate date] timeIntervalSince1970] * 1000)];
        UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
        [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:^(NSError * _Nullable error) {
            if (error) {
                NSLog(@"[TaskDashboard] 發送系統通知失敗: %@", error.localizedDescription);
            }
        }];
    } @catch (NSException *exception) {
        NSLog(@"[TaskDashboard] 系統通知發送異常: %@", exception.reason);
    }
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
    if (@available(macOS 11.0, *)) {
        completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
    } else {
        completionHandler(UNNotificationPresentationOptionSound);
    }
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler {
    NSString *taskId = @"";
    NSDictionary *userInfo = response.notification.request.content.userInfo;
    if ([userInfo isKindOfClass:[NSDictionary class]] && [userInfo[@"taskId"] isKindOfClass:[NSString class]]) {
        taskId = userInfo[@"taskId"];
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp activateIgnoringOtherApps:YES];
        [self.window makeKeyAndOrderFront:nil];
        NSString *escaped = [[taskId stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"]
                             stringByReplacingOccurrencesOfString:@"'" withString:@"\\'"];
        NSString *js = [NSString stringWithFormat:@"if (window.openTaskFromNativeNotification) window.openTaskFromNativeNotification('%@');", escaped];
        [self.webView evaluateJavaScript:js completionHandler:nil];
        completionHandler();
    });
}

// 支援外部連結與 target="_blank" 呼叫系統預設瀏覽器開啟 (解決 Proxy Server 驗證連結無反應問題)
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    if (!url) {
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }

    // 點選 target="_blank" 或新視窗連結
    if (navigationAction.targetFrame == nil) {
        [[NSWorkspace sharedWorkspace] openURL:url];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }

    // 非本機主 Dashboard (非 localhost:3030 或 127.0.0.1:3030) 的外部連結或 proxy 網址，一律用系統預設瀏覽器開啟
    NSString *host = url.host.lowercaseString;
    NSNumber *port = url.port;

    BOOL isLocalDashboard = (([host isEqualToString:@"localhost"] || [host isEqualToString:@"127.0.0.1"]) &&
                             (port == nil || [port intValue] == 3030));

    if (!isLocalDashboard && navigationAction.navigationType == WKNavigationTypeLinkActivated) {
        [[NSWorkspace sharedWorkspace] openURL:url];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }

    decisionHandler(WKNavigationActionPolicyAllow);
}

// 支援 window.open 與 target="_blank" 建立新視窗請求
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)navigationAction windowFeatures:(WKWindowFeatures *)windowFeatures {
    if (navigationAction.request.URL) {
        [[NSWorkspace sharedWorkspace] openURL:navigationAction.request.URL];
    }
    return nil;
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"[TaskDashboard] 初始載入失敗，重試中... 原因: %@", error.localizedDescription);
    [self startServerIfNeeded];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(500 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        NSURL *url = [NSURL URLWithString:@"http://localhost:3030"];
        [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
    });
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"[TaskDashboard] 頁面載入失敗，重試中... 原因: %@", error.localizedDescription);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(500 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        NSURL *url = [NSURL URLWithString:@"http://localhost:3030"];
        [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
    });
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    NSLog(@"[TaskDashboard] Web 渲染程序重啟中...");
    NSURL *url = [NSURL URLWithString:@"http://localhost:3030"];
    [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
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

// 支援 JavaScript window.prompt 原生輸入對話框 (支援修改 Proxy Server 網址等自訂輸入)
- (void)webView:(WKWebView *)webView runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString * _Nullable result))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"設定網址";
    alert.informativeText = prompt;
    [alert addButtonWithTitle:@"確定"];
    [alert addButtonWithTitle:@"取消"];
    alert.alertStyle = NSAlertStyleInformational;

    NSTextField *input = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 340, 24)];
    input.stringValue = defaultText ?: @"";
    alert.accessoryView = input;

    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse returnCode) {
        if (returnCode == NSAlertFirstButtonReturn) {
            completionHandler(input.stringValue);
        } else {
            completionHandler(nil);
        }
    }];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self setupMainMenu];
    [self setupUserNotifications];
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
    [userContentController addScriptMessageHandler:self name:@"openExternalUrl"];
    [userContentController addScriptMessageHandler:self name:@"updateDockBadge"];
    [userContentController addScriptMessageHandler:self name:@"notifyUserAttention"];

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
