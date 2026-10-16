import {
  generateChaosTrajectory,
  type Point,
  type PathStep,
  type ChaosKinematicsOptions,
} from './chaos-kinematics.js';

export type { Point, PathStep, ChaosKinematicsOptions };
export { generateChaosTrajectory };

/**
 * Generates an organic, human-like trajectory between two coordinates.
 * Powered by the Kuang Grade Mark Eleven Bio-Kinematic Chaos Engine:
 * - Ornstein-Uhlenbeck 1/f Pink Noise tremor
 * - Asymmetric log-normal / minimum-jerk acceleration & braking
 * - Two-Thirds Power Law curvature-velocity coupling
 * - Ballistic target overshoot & saccadic micro-corrections
 * - Duffing strange attractor perturbations
 */
export function generateOrganicTrajectory(
  start: Point,
  target: Point,
  options: ChaosKinematicsOptions = {}
): PathStep[] {
  return generateChaosTrajectory(start, target, options);
}
