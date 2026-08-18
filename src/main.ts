import { ExperienceController } from './app/ExperienceController.ts';
import { wantsCalibration, wantsHud } from './utils/env.ts';

const experience = new ExperienceController();
experience.start();

// Dev-only tooling. `import.meta.env.DEV` is replaced with `false` in a
// production build, so both branches — and the chunks they import — are
// dropped entirely rather than shipped behind a runtime flag.
if (import.meta.env.DEV && wantsCalibration()) {
  void import('./choice/calibration.dev.ts').then(({ startCalibration }) => {
    const stage = document.getElementById('stage');
    if (stage) startCalibration(stage, experience.layout, experience.disposables);
  });
}

if (import.meta.env.DEV && wantsHud()) {
  void import('./ui/devHud.dev.ts').then(({ startHud }) => {
    startHud(
      experience.machine,
      experience.layout,
      experience.scrubber,
      experience.introVideo,
      experience.disposables,
    );
  });
}
