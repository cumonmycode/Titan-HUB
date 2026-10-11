// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Текст — только через обёртку: она растит шрифт по кривой системного стиля и ограничивает
    // рост. Голый Text из react-native на крупном тексте и «Увеличенном» виде разъезжается.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/text.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-native",
              importNames: ["Text", "TextInput"],
              allowTypeImports: true,
              message: "Text и TextInput — из '@/components/text' (рост шрифта и потолок крупного текста).",
            },
          ],
        },
      ],
    },
  },
]);
