#!/bin/sh
set -e
cd "$(dirname "$0")"
cat src/p1_core.js src/p2_world.js src/p3_acts.js src/p4_social.js src/p5_life.js src/p6_goals.js > public/sim.mjs
cat src/v1_scene.js src/v2_live.js src/v3_ui.js > public/view.mjs
node --check public/sim.mjs
node --check public/view.mjs
echo built
