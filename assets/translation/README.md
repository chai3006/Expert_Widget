# Offline translation (German → English)

The News feed is translated on this PC, without any network access, by the Bergamot translation
engine and a German→English model from Mozilla's Firefox Translations project.

- Engine: `@browsermt/bergamot-translator` 0.4.9 (WebAssembly build), MPL-2.0,
  https://github.com/browsermt/bergamot-translator
- Model: Firefox Translations `tiny` de→en (`model.deen.intgemm.alphas.bin`,
  `lex.50.50.deen.s2t.bin`, `vocab.deen.spm`), MPL-2.0,
  https://github.com/mozilla/firefox-translations-models

Both are used unmodified. The model files in `deen/` are not stored in git; `npm run compile`
downloads them once (`scripts/get-translation-model.mjs`) and checks their SHA-256 hashes.
The MPL-2.0 licence text: https://mozilla.org/MPL/2.0/
