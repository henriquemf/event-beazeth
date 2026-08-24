(function () {
    const STORAGE_KEYS = {
        theme: "en_theme",
        font: "en_font",
        dark: "en_dark",
    };

    const defaults = {
        theme: "rose",
        font: "sugar",
        dark: false,
    };

    const validThemes = [
        "rose",
        "berry",
        "peach",
        "lavender",
        "mint",
        "sunset",
        "ocean",
        "plum",
        "cocoa",
        "strawberry",
    ];

    const validFonts = [
        "sugar",
        "bubble",
        "love",
        "daisy",
        "glam",
        "cotton",
        "diary",
        "pearl",
        "chic",
        "dream",
    ];

    function readValue(key, fallback) {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
    }

    function applyPreferences(theme, font, dark) {
        // Aplicado no <html> e no <body>: o <html> pinta o fundo do canvas
        // (área de overscroll) e o <body> mantém os seletores existentes.
        [document.documentElement, document.body].forEach(function (node) {
            if (!node) {
                return;
            }
            node.dataset.theme = theme;
            node.dataset.font = font;
            node.dataset.dark = String(Boolean(dark));
        });
    }

    function normalizeTheme(theme) {
        return validThemes.includes(theme) ? theme : defaults.theme;
    }

    function normalizeFont(font) {
        return validFonts.includes(font) ? font : defaults.font;
    }

    function readPreferences() {
        const savedTheme = normalizeTheme(readValue(STORAGE_KEYS.theme, defaults.theme));
        const savedFont = normalizeFont(readValue(STORAGE_KEYS.font, defaults.font));
        const savedDark = readValue(STORAGE_KEYS.dark, String(defaults.dark)) === "true";
        return { theme: savedTheme, font: savedFont, dark: savedDark };
    }

    function syncPreviewState(theme, font) {
        document.querySelectorAll(".theme-preview").forEach(function (button) {
            button.classList.toggle("active", button.dataset.theme === theme);
        });

        document.querySelectorAll(".font-preview").forEach(function (button) {
            button.classList.toggle("active", button.dataset.font === font);
        });
    }

    function saveAndApply(theme, font, dark, options) {
        const normalizedTheme = normalizeTheme(theme);
        const normalizedFont = normalizeFont(font);
        const normalizedDark = Boolean(dark);

        localStorage.setItem(STORAGE_KEYS.theme, normalizedTheme);
        localStorage.setItem(STORAGE_KEYS.font, normalizedFont);
        localStorage.setItem(STORAGE_KEYS.dark, String(normalizedDark));
        applyPreferences(normalizedTheme, normalizedFont, normalizedDark);

        if (options && options.darkToggle) {
            options.darkToggle.checked = normalizedDark;
        }
        syncPreviewState(normalizedTheme, normalizedFont);
    }

    const initial = readPreferences();
    applyPreferences(initial.theme, initial.font, initial.dark);

    function initControls() {
        const darkToggle = document.getElementById("dark-toggle");
        const options = { darkToggle };

        saveAndApply(initial.theme, initial.font, initial.dark, options);

        /* Estado atual lido do <body>, que o bootstrap de tema já preencheu
           antes da primeira pintura. */
        function current(key, fallback) {
            return document.body.dataset[key] || fallback;
        }

        function isDark() {
            return darkToggle ? darkToggle.checked : document.body.dataset.dark === "true";
        }

        if (darkToggle) {
            darkToggle.addEventListener("change", function () {
                saveAndApply(
                    current("theme", initial.theme),
                    current("font", initial.font),
                    darkToggle.checked,
                    options
                );
            });
        }

        document.querySelectorAll(".theme-preview").forEach(function (button) {
            button.addEventListener("click", function () {
                saveAndApply(
                    button.dataset.theme || defaults.theme,
                    current("font", initial.font),
                    isDark(),
                    options
                );
            });
        });

        document.querySelectorAll(".font-preview").forEach(function (button) {
            button.addEventListener("click", function () {
                saveAndApply(
                    current("theme", initial.theme),
                    button.dataset.font || defaults.font,
                    isDark(),
                    options
                );
            });
        });
    }

    document.addEventListener("DOMContentLoaded", initControls);
})();
