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
        document.body.dataset.theme = theme;
        document.body.dataset.font = font;
        document.body.dataset.dark = String(Boolean(dark));
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

        if (options && options.themeSelect) {
            options.themeSelect.value = normalizedTheme;
        }
        if (options && options.fontSelect) {
            options.fontSelect.value = normalizedFont;
        }
        if (options && options.darkToggle) {
            options.darkToggle.checked = normalizedDark;
        }
        syncPreviewState(normalizedTheme, normalizedFont);
    }

    const initial = readPreferences();
    applyPreferences(initial.theme, initial.font, initial.dark);

    function initControls() {
        const themeSelect = document.getElementById("theme-select");
        const fontSelect = document.getElementById("font-select");
        const darkToggle = document.getElementById("dark-toggle");
        const options = { themeSelect, fontSelect, darkToggle };

        saveAndApply(initial.theme, initial.font, initial.dark, options);

        if (themeSelect && fontSelect) {
            themeSelect.addEventListener("change", function () {
                saveAndApply(themeSelect.value, fontSelect.value, darkToggle ? darkToggle.checked : initial.dark, options);
            });

            fontSelect.addEventListener("change", function () {
                saveAndApply(themeSelect.value, fontSelect.value, darkToggle ? darkToggle.checked : initial.dark, options);
            });
        }

        if (darkToggle) {
            darkToggle.addEventListener("change", function () {
                const currentTheme = themeSelect ? themeSelect.value : document.body.dataset.theme || initial.theme;
                const currentFont = fontSelect ? fontSelect.value : document.body.dataset.font || initial.font;
                saveAndApply(currentTheme, currentFont, darkToggle.checked, options);
            });
        }

        document.querySelectorAll(".theme-preview").forEach(function (button) {
            button.addEventListener("click", function () {
                const theme = button.dataset.theme || defaults.theme;
                const currentFont = fontSelect ? fontSelect.value : document.body.dataset.font || initial.font;
                const currentDark = darkToggle ? darkToggle.checked : (document.body.dataset.dark === "true");
                saveAndApply(theme, currentFont, currentDark, options);
            });
        });

        document.querySelectorAll(".font-preview").forEach(function (button) {
            button.addEventListener("click", function () {
                const font = button.dataset.font || defaults.font;
                const currentTheme = themeSelect ? themeSelect.value : document.body.dataset.theme || initial.theme;
                const currentDark = darkToggle ? darkToggle.checked : (document.body.dataset.dark === "true");
                saveAndApply(currentTheme, font, currentDark, options);
            });
        });
    }

    document.addEventListener("DOMContentLoaded", initControls);
})();
