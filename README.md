# Цитадель — CITADEL 1.3 «Цепь командования»

Симулятор командования осаждённым гарнизоном. 3D в стиле PS1, вид от первого лица из штабного блиндажа.
Вы командуете обороной: ставите задачи участкам, а приказы идут по цепочке — начальник штаба → командиры участков → сержанты → бойцы.

- `docs/CITADEL_UPDATE_1.3.md` — что нового в 1.3 и как устроена цепь командования.
- `docs/CITADEL_CONCEPT_v1.0.md` — концепт-документ.
- `game/` — игра (Three.js + собственный PS1-шейдер, симуляция на JS).
- `android/` — сборка APK без Android SDK (javac → dx → ручной бинарный манифест → apksig).
- `dist/Citadel-*.apk` — готовая сборка.

## Сборка

```bash
cd game && npm install && npm run build      # dist/game.js + index.html
node tools/simtest.mjs good 20                # прогон кампании ботом (баланс)
cd .. && VNAME=1.3.0 VCODE=6 ./android/build.sh   # dist/Citadel-1.3.0.apk
```

Для `build.sh` нужны JDK 17+ и python3; jar-инструменты скачиваются из Maven Central скриптом `android/fetch-tools.sh`.
Для запуска в браузере откройте `game/dist/index.html`.
