# Signal Defense 2600 (Lite Edition)

Missile defense meets tower defense, in Atari colours. Shoot down what's falling on your cities by hand, and between waves spend your earnings on towers, city upgrades and the links that let cities share survivors.

This is the **Lite Edition**: a 12-wave campaign of the prototype that grew into **Vector Interceptor 2600**. One HTML file, one CSS file, one JS file. No build step, no dependencies.

## Play

Open `index.html` in a browser (or serve the folder with any static server).

- **Click / tap** to fire an interceptor from the nearest base
- **Between waves:** buy and upgrade towers (cannon / laser / shield) on build slots, grow cities, and buy connectors
- **Esc** pauses

## How it's built

- **A fixed virtual resolution.** All logic runs in 960×540 space and the canvas scales it up 2×. Hit tests, entities and input all use the same coordinates.
- **A tiny state machine:** `title → build → combat → waveComplete → build …`, plus `pause` and `gameOver`.
- **Entity classes own their own `update` and `draw`:** `City`, `MissileBase`, `Enemy`, `Interceptor`, `Explosion`, `Tower`, `BuildSlot`. The game updates arrays and filters out the dead.
- **Immediate-mode UI:** buttons are re-registered every frame while drawing, and the pointer handler hit-tests them first.

It's a clean, readable base for your own arcade defense game.

## What the full game adds

Vector Interceptor 2600 builds on this with city specialisations (spread shots, EMP pulse, ammo reactor), more enemy types (diving swoopers, marching invader squadrons…) and no wave limit. Get it, with the source of every SpaceChakra game, on [Patreon](https://patreon.com/spacechakra).

## License

Code: MIT (see [LICENSE](LICENSE)). The names "Signal Defense 2600", "Vector Interceptor 2600" and the SpaceChakra brand aren't covered, so please give your remix its own name.

Made by [SpaceChakra](https://patreon.com/spacechakra) · more games at [spacechakra.itch.io](https://spacechakra.itch.io)
