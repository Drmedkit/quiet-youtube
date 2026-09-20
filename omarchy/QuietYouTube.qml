import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
    id: root

    property var info: ({
        "configured": false,
        "enabled": false,
        "settings": {
            "channels": []
        }
    })
    property bool available: false
    property string errorText: ""
    property string noticeText: ""
    property string token: ""
    property double expiresAt: 0
    property bool changingPassword: false
    readonly property bool unlocked: token !== "" && expiresAt > Date.now() / 1000
    readonly property bool busy: rpc.running || installProc.running
    readonly property string pluginPath: decodeURIComponent(Qt.resolvedUrl("..").toString().replace(/^file:\/\//, "").replace(/\/$/, ""))
    readonly property string client: pluginPath + "/native/quiet-youtube"
    readonly property var filters: [{
        "key": "hideShorts",
        "label": "Block Shorts"
    }, {
        "key": "hideRecommendations",
        "label": "Hide recommendations"
    }, {
        "key": "hideComments",
        "label": "Hide comments"
    }, {
        "key": "hideSearch",
        "label": "Hide search"
    }, {
        "key": "hideEndScreens",
        "label": "Hide end screens"
    }, {
        "key": "hideLiveChat",
        "label": "Hide live chat"
    }, {
        "key": "hideNotifications",
        "label": "Hide notifications"
    }, {
        "key": "disableAutoplay",
        "label": "Stop autoplay"
    }]

    function request(payload, administrator) {
        if (busy)
            return ;

        errorText = "";
        rpc.operation = payload.op;
        if (token !== "")
            payload.token = token;

        rpc.pending = JSON.stringify(payload);
        rpc.command = administrator ? ["pkexec", "/usr/local/lib/quiet-youtube/quiet-youtube", "rpc"] : [client, "rpc"];
        rpc.running = true;
    }

    function refresh() {
        request({
            "op": "status"
        }, false);
    }

    function lockPanel() {
        if (token !== "" && !logoutProc.running) {
            logoutProc.pending = JSON.stringify({
                "op": "logout",
                "token": token
            });
            logoutProc.running = true;
        }
        token = "";
        expiresAt = 0;
        passwordInput.clear();
        repeatInput.clear();
        changingPassword = false;
    }

    function submitPassword() {
        const isNew = !info.configured || changingPassword;
        if (isNew && passwordInput.text !== repeatInput.text) {
            errorText = "The passwords do not match.";
            return ;
        }
        const payload = {
            "op": !info.configured ? "setup" : changingPassword ? "password.change" : "login",
            "password": passwordInput.text
        };
        passwordInput.clear();
        repeatInput.clear();
        request(payload, !info.configured);
    }

    function receive(raw) {
        let reply;
        try {
            reply = JSON.parse(raw);
        } catch (e) {
            errorText = "The parent service did not reply. Try again.";
            return ;
        }
        if (!reply.ok) {
            if (reply.error.code === "unavailable")
                available = false;
            else
                errorText = reply.error.message;
            if (["locked", "wrong_password", "rate_limited"].indexOf(reply.error.code) !== -1)
                lockPanel();

            return ;
        }
        available = true;
        if (rpc.operation === "login") {
            // A late response must not unlock a panel that has already closed.
            if (opened) {
                token = reply.data.token;
                expiresAt = reply.data.expiresAt;
            }
        } else if (rpc.operation === "session.cli") {
            noticeText = "CLI access is allowed until " + new Date(reply.data.expiresAt * 1000).toLocaleTimeString() + ". It stays available when this panel closes.";
        } else {
            info = reply.data;
            if (rpc.operation === "password.change" || rpc.operation === "setup")
                lockPanel();

        }
    }

    moduleName: "kids.quiet-youtube"
    ipcTarget: "kids.quiet-youtube"
    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight
    onOpenedChanged: {
        if (opened) {
            refresh();
        } else {
            passwordInput.clear();
            repeatInput.clear();
        }
    }
    Component.onCompleted: refresh()

    Process {
        id: rpc

        property string pending: ""
        property string operation: ""

        stdinEnabled: true
        onStarted: {
            write(pending + "\n");
            pending = "";
        }

        stdout: StdioCollector {
            onStreamFinished: root.receive(this.text)
        }

    }

    Process {
        id: logoutProc

        property string pending: ""

        command: [root.client, "rpc"]
        stdinEnabled: true
        onStarted: {
            write(pending + "\n");
            pending = "";
        }

        stdout: StdioCollector {
        }

    }

    Process {
        id: installProc

        command: ["pkexec", root.pluginPath + "/packaging/install-system.py", "--browser", "chromium"]
        onExited: function(exitCode) {
            if (exitCode !== 0)
                root.errorText = "Installation was not completed. You can try again.";
            else
                Qt.callLater(root.refresh);
        }

        stdout: StdioCollector {
        }

    }

    Timer {
        interval: 1000
        running: root.token !== ""
        repeat: true
        onTriggered: {
            if (Date.now() / 1000 >= root.expiresAt)
                root.lockPanel();

        }
    }

    Timer {
        interval: 10000
        running: root.opened
        repeat: true
        onTriggered: {
            if (!root.busy)
                root.refresh();

        }
    }

    BarIconButton {
        id: button

        anchors.fill: parent
        bar: root.bar
        text: "󰗃"
        onPressed: root.toggle()
    }

    KeyboardPanel {
        id: panel

        owner: root
        anchorItem: button
        bar: root.bar
        open: root.opened
        focusTarget: content
        contentWidth: panel.fittedContentWidth(Style.space(350))
        contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(650))

        FocusScope {
            id: content

            anchors.fill: parent
            Keys.onEscapePressed: root.close()

            Controls.ScrollView {
                anchors.fill: parent
                clip: true
                contentWidth: availableWidth

                ColumnLayout {
                    id: column

                    width: parent.width
                    spacing: Style.space(12)

                    Controls.Label {
                        text: "Quiet YouTube"
                        color: Color.foreground
                        font.family: Style.font.family
                        font.pixelSize: Style.font.title
                    }

                    Controls.Label {
                        Layout.fillWidth: true
                        text: !root.available ? "Set up parent controls" : !root.info.configured ? "Choose a parent password" : root.info.enabled ? "Approved channels only" : "Protection paused by a parent"
                        wrapMode: Text.WordWrap
                        color: Color.foreground
                    }

                    Controls.Label {
                        Layout.fillWidth: true
                        visible: root.available && root.info.deployment === "demo"
                        text: "Preview only — this service does not apply browser rules."
                        color: Color.urgent
                        wrapMode: Text.WordWrap
                    }

                    Action {
                        text: "Open YouTube"
                        onClicked: {
                            const browser = root.info.browser === "chrome" ? "google-chrome-stable" : root.info.browser === "brave" ? "brave-browser" : "chromium";
                            Quickshell.execDetached([browser, "https://www.youtube.com/feed/subscriptions"]);
                            root.close();
                        }
                    }

                    Controls.Label {
                        visible: !root.available
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: "Install the parent service once with administrator authentication. Removing this menu will not turn the service off."
                        color: Color.muted
                    }

                    Action {
                        visible: !root.available
                        text: root.busy ? "Installing…" : "Install parent controls"
                        enabled: !root.busy
                        onClicked: installProc.running = true
                    }

                    Controls.Label {
                        visible: root.available && !root.info.configured
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: "Use at least 6 characters or digits. Setup enables protection for every " + (root.info.browser || "Chromium") + " profile on this computer. Approve channels after unlocking."
                        color: Color.muted
                    }

                    ColumnLayout {
                        visible: root.available && (!root.unlocked || root.changingPassword)
                        Layout.fillWidth: true
                        spacing: Style.space(8)

                        Controls.TextField {
                            id: passwordInput

                            Layout.fillWidth: true
                            placeholderText: !root.info.configured || root.changingPassword ? "Choose parent password" : "Parent password"
                            echoMode: TextInput.Password
                            maximumLength: 128
                            enabled: !root.busy
                            onAccepted: root.submitPassword()
                        }

                        Controls.TextField {
                            id: repeatInput

                            Layout.fillWidth: true
                            visible: !root.info.configured || root.changingPassword
                            placeholderText: "Repeat password"
                            echoMode: TextInput.Password
                            maximumLength: 128
                            enabled: !root.busy
                            onAccepted: root.submitPassword()
                        }

                        Action {
                            text: root.busy ? "Please wait…" : !root.info.configured ? "Set password and enable" : root.changingPassword ? "Save new password" : "Unlock parent controls"
                            enabled: !root.busy && passwordInput.text.length >= 6
                            onClicked: root.submitPassword()
                        }

                    }

                    Controls.Label {
                        visible: root.errorText !== ""
                        Layout.fillWidth: true
                        text: root.errorText
                        wrapMode: Text.WordWrap
                        color: Color.urgent
                    }

                    Controls.Label {
                        visible: root.noticeText !== ""
                        Layout.fillWidth: true
                        text: root.noticeText
                        wrapMode: Text.WordWrap
                        color: Color.foreground
                    }

                    Action {
                        visible: root.unlocked
                        text: "Allow agent / CLI access"
                        enabled: !root.busy
                        onClicked: root.request({
                            "op": "session.cli"
                        }, false)
                    }

                    RowLayout {
                        visible: root.unlocked
                        Layout.fillWidth: true

                        Action {
                            text: "Close"
                            onClicked: {
                                root.lockPanel();
                                root.close();
                            }
                        }

                        Action {
                            text: "Change password"
                            onClicked: root.changingPassword = !root.changingPassword
                        }

                    }

                    Controls.Label {
                        visible: root.available && root.info.configured
                        Layout.fillWidth: true
                        text: root.unlocked ? "Unlocked for 15 minutes. Reopening this menu keeps your session. Close ends it early." : "Unlock to change channels and settings."
                        wrapMode: Text.WordWrap
                        color: Color.muted
                    }

                    Action {
                        visible: root.available && root.info.configured
                        text: root.info.enabled ? "Pause protection" : "Resume protection"
                        enabled: root.unlocked && !root.busy
                        onClicked: root.request({
                            "op": "protection.set",
                            "enabled": !root.info.enabled
                        }, false)
                    }

                    PanelSectionHeader {
                        visible: root.available && root.info.configured
                        text: "APPROVED CHANNELS"
                    }

                    Repeater {
                        model: root.available ? root.info.settings.channels : []

                        delegate: RowLayout {
                            required property var modelData

                            Layout.fillWidth: true

                            Controls.Label {
                                Layout.fillWidth: true
                                text: modelData.name
                                textFormat: Text.PlainText
                                color: Color.foreground
                                elide: Text.ElideRight
                            }

                            Action {
                                text: "Remove"
                                enabled: root.unlocked && !root.busy
                                onClicked: root.request({
                                    "op": "channels.remove",
                                    "id": modelData.id
                                }, false)
                            }

                        }

                    }

                    RowLayout {
                        visible: root.available && root.info.configured
                        Layout.fillWidth: true

                        Controls.TextField {
                            id: channelInput

                            Layout.fillWidth: true
                            placeholderText: "@channel or channel URL"
                            maximumLength: 500
                            enabled: root.unlocked && !root.busy
                        }

                        Action {
                            text: "Add"
                            enabled: root.unlocked && !root.busy && channelInput.text.trim() !== ""
                            onClicked: {
                                root.request({
                                    "op": "channels.add",
                                    "input": channelInput.text
                                }, false);
                                channelInput.clear();
                            }
                        }

                    }

                    PanelSectionHeader {
                        visible: root.available && root.info.configured
                        text: "YOUTUBE SETTINGS"
                    }

                    Repeater {
                        model: root.available && root.info.configured ? root.filters : []

                        delegate: Controls.CheckBox {
                            required property var modelData

                            Layout.fillWidth: true
                            text: modelData.label
                            checked: root.info.settings[modelData.key] === true
                            enabled: root.unlocked && !root.busy
                            onClicked: root.request({
                                "op": "settings.set",
                                "key": modelData.key,
                                "value": checked
                            }, false)
                        }

                    }

                    Controls.ComboBox {
                        visible: root.available && root.info.configured
                        Layout.fillWidth: true
                        model: ["Open Subscriptions", "Keep YouTube Home"]
                        currentIndex: root.info.settings.homeFeed === "home" ? 1 : 0
                        enabled: root.unlocked && !root.busy
                        onActivated: root.request({
                            "op": "settings.set",
                            "key": "homeFeed",
                            "value": currentIndex === 1 ? "home" : "subscriptions"
                        }, false)
                    }

                }

            }

        }

    }

    component Action: Controls.Button {
        font.family: Style.font.family

        contentItem: Text {
            text: parent.text
            font: parent.font
            color: parent.enabled ? Color.foreground : Color.muted
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }

        background: Rectangle {
            radius: Style.cornerRadius
            color: parent.down ? Qt.alpha(Color.foreground, 0.16) : parent.hovered ? Qt.alpha(Color.foreground, 0.1) : Qt.alpha(Color.foreground, 0.05)
            border.width: parent.activeFocus ? 2 : 1
            border.color: parent.activeFocus ? Color.accent : Qt.alpha(Color.foreground, 0.2)
        }

    }

}
