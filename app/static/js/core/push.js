(function () {
    const FALLBACK_KEY = "web_notify_live_fallback";
    const FALLBACK_INTERVAL_MS = 60000;
    const enableBtn = document.getElementById("push-enable-btn");
    const testBtn = document.getElementById("push-test-btn");
    const statusEl = document.getElementById("push-status");
    let fallbackTimer = null;

    if (!enableBtn || !testBtn || !statusEl) {
        return;
    }

    function setStatus(text, type) {
        statusEl.textContent = "Status: " + text;
        statusEl.dataset.state = type || "neutral";
    }

    function isLikelyEmbeddedWebView() {
        const ua = (navigator.userAgent || "").toLowerCase();
        return ua.includes("wv") || ua.includes("electron") || ua.includes("vscode") || ua.includes("webview");
    }

    function isFallbackEnabled() {
        return localStorage.getItem(FALLBACK_KEY) === "1";
    }

    function setFallbackEnabled(enabled) {
        localStorage.setItem(FALLBACK_KEY, enabled ? "1" : "0");
    }

    function formatSubscribeError(err) {
        const msg = (err && err.message ? err.message : "").toLowerCase();

        if (msg.includes("permission") || msg.includes("denied")) {
            return "Permissão de notificação bloqueada";
        }

        if (msg.includes("registration failed") || msg.includes("push service error")) {
            if (isLikelyEmbeddedWebView()) {
                return "Push indisponível nesta webview. Abra no Chrome/Edge";
            }
            return "Falha no serviço push. Modo em tempo real ativado";
        }

        if (msg.includes("applicationserverkey") || msg.includes("invalidaccess")) {
            return "Chave VAPID inválida para este navegador";
        }

        return (err && err.message) ? err.message : "Erro ao ativar";
    }

    function canEnableFallback(message) {
        const msg = (message || "").toLowerCase();
        if (!msg) {
            return true;
        }
        if (msg.includes("permissão") || msg.includes("permission") || msg.includes("denied")) {
            return false;
        }
        if (msg.includes("vapid") || msg.includes("applicationserverkey") || msg.includes("invalidaccess")) {
            return false;
        }
        return true;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    async function getPublicKey() {
        const response = await fetch("/api/push/public-key");
        const data = await response.json();
        return (data.publicKey || "").trim().replace(/^"|"$/g, "");
    }

    async function registerSubscription() {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
            setStatus("Navegador sem suporte", "error");
            return;
        }

        if (!window.isSecureContext) {
            setStatus("Use HTTPS ou localhost", "error");
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            setStatus("Permissão negada", "error");
            return;
        }

        const publicKey = await getPublicKey();
        if (!publicKey) {
            setStatus("Chave VAPID ausente no servidor", "error");
            return;
        }

        if (publicKey.length < 80) {
            setStatus("Chave VAPID inválida", "error");
            return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        await registration.update();
        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            try {
                await subscription.unsubscribe();
            } catch (err) {
                // Ignore unsubscribe errors and attempt a clean subscribe anyway.
            }
            subscription = null;
        }

        if (!subscription) {
            try {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey),
                });
            } catch (err) {
                throw new Error(formatSubscribeError(err));
            }
        }

        const response = await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(subscription),
        });

        if (response.ok) {
            setFallbackEnabled(false);
            setStatus("Ativadas", "success");
        } else {
            const data = await response.json().catch(function () { return {}; });
            setStatus(data.message || "Falha ao registrar", "error");
        }
    }

    async function showLocalNotification(payload) {
        const title = payload.title || "Event Notifier";
        const options = {
            body: payload.body || "",
            icon: payload.icon || "/static/icon.svg",
            tag: payload.tag || "live-notification",
        };

        const registration = await navigator.serviceWorker.getRegistration("/");
        if (registration) {
            await registration.showNotification(title, options);
            return;
        }

        if (Notification.permission === "granted") {
            new Notification(title, options);
        }
    }

    async function pollLiveNotifications() {
        if (!isFallbackEnabled()) {
            return;
        }
        if (Notification.permission !== "granted") {
            return;
        }

        const response = await fetch("/api/live/notifications");
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        const items = data.items || [];
        for (const item of items) {
            await showLocalNotification(item);
        }
    }

    function startLiveFallbackLoop() {
        if (!isFallbackEnabled() || fallbackTimer) {
            return;
        }
        pollLiveNotifications().catch(function () {});
        fallbackTimer = window.setInterval(function () {
            pollLiveNotifications().catch(function () {});
        }, FALLBACK_INTERVAL_MS);
    }

    async function checkStatus() {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
            setStatus("Navegador sem suporte", "error");
            return;
        }

        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        setStatus(subscription ? "Ativadas" : "Não ativadas", subscription ? "success" : "neutral");
    }

    async function sendTest() {
        const response = await fetch("/api/push/test", { method: "POST" });
        if (response.ok) {
            setStatus("Teste enviado", "success");
        } else {
            const data = await response.json().catch(function () { return {}; });
            if (isFallbackEnabled()) {
                await showLocalNotification({
                    title: "Teste Web 💗",
                    body: "Modo em tempo real ativo na aba aberta.",
                    icon: "/static/icon.svg",
                    tag: "live-test",
                });
                setStatus("Teste local enviado (modo em tempo real)", "success");
                return;
            }
            setStatus(data.message || "Ative as notificações primeiro", "error");
        }
    }

    enableBtn.addEventListener("click", function () {
        enableBtn.disabled = true;
        registerSubscription().catch(function (err) {
            const msg = formatSubscribeError(err);
            if (msg.includes("Modo em tempo real") || canEnableFallback(msg)) {
                setFallbackEnabled(true);
                startLiveFallbackLoop();
            }
            setStatus(msg, "error");
        }).finally(function () {
            enableBtn.disabled = false;
        });
    });

    testBtn.addEventListener("click", function () {
        testBtn.disabled = true;
        sendTest().catch(function (err) {
            setStatus((err && err.message) ? err.message : "Erro no teste", "error");
        }).finally(function () {
            testBtn.disabled = false;
        });
    });

    checkStatus().catch(function () {
        setStatus("Indisponível", "error");
    });

    if (isFallbackEnabled()) {
        setStatus("Modo em tempo real ativo", "success");
        startLiveFallbackLoop();
    }
})();
