# Цитадель

Симулятор командования осаждённым гарнизоном. 3D в стиле PS1, вид от первого лица из штабного блиндажа.

- `docs/CITADEL_CONCEPT_v1.0.md` — концепт-документ.
- `game/` — игра (Three.js + собственный PS1-шейдер, симуляция на JS).
- `android/` — сборка APK без Android SDK (javac → dx → ручной бинарный манифест → apksig).
- `dist/Citadel-*.apk` — готовая сборка.

## Сборка

```bash
cd game && npm install && npm run build      # dist/game.js + index.html
node tools/simtest.mjs good 20                # прогон кампании ботом (баланс)
cd .. && ./android/build.sh                   # dist/Citadel-0.1.0.apk
```

Для `build.sh` нужны JDK 17+ и python3; jar-инструменты скачиваются из Maven Central скриптом `android/fetch-tools.sh`.
Для запуска в браузере откройте `game/dist/index.html`.
