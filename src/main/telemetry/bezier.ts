export interface Point {
  x: number;
  y: number;
}

export interface PathStep extends Point {
  delayMs: number;
  velocity: number; // pixels per ms
}

/**
 * Calculates a point on a cubic Bézier curve.
 */
function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const oneMinusT = 1 - t;
  const oneMinusT2 = oneMinusT * oneMinusT;
  const oneMinusT3 = oneMinusT2 * oneMinusT;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: oneMinusT3 * p0.x + 3 * oneMinusT2 * t * p1.x + 3 * oneMinusT * t2 * p2.x + t3 * p3.x,
    y: oneMinusT3 * p0.y + 3 * oneMinusT2 * t * p1.y + 3 * oneMinusT * t2 * p2.y + t3 * p3.y,
  };
}

/**
 * Generates an organic, human-like Bézier trajectory between two coordinates.
 * Includes subtle micro-jitter, ease-in/ease-out acceleration, and human reaction latency.
 */
export function generateOrganicTrajectory(
  start: Point,
  target: Point,
  options: {
    steps?: number;
    deviationMultiplier?: number;
    baseDelayMs?: number;
  } = {}
): PathStep[] {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.hypot(dx, dy);

  // Dynamic step count based on distance for silky smooth human motion
  const steps = options.steps ?? Math.max(35, Math.min(120, Math.floor(distance / 6)));
  const deviation = options.deviationMultiplier ?? 0.22;

  // Generate organic control points perpendicular to direction vector
  const normalX = -dy / (distance || 1);
  const normalY = dx / (distance || 1);

  // Random side curvature
  const curveMagnitude1 = (Math.random() - 0.45) * distance * deviation;
  const curveMagnitude2 = (Math.random() - 0.45) * distance * deviation;

  const cp1: Point = {
    x: start.x + dx * 0.25 + normalX * curveMagnitude1,
    y: start.y + dy * 0.25 + normalY * curveMagnitude1,
  };

  const cp2: Point = {
    x: start.x + dx * 0.75 + normalX * curveMagnitude2,
    y: start.y + dy * 0.75 + normalY * curveMagnitude2,
  };

  const trajectory: PathStep[] = [];
  let previousPoint = start;

  for (let i = 0; i <= steps; i++) {
    // S-curve ease-in / ease-out mapping for t
    const rawT = i / steps;
    // Smooth cosine/quintic polynomial acceleration
    const easedT = rawT * rawT * (3 - 2 * rawT);

    const point = cubicBezier(start, cp1, cp2, target, easedT);

    // Micro-jitter simulation for human hand tremor (less jitter at exact target)
    const proximityToEnd = 1 - rawT;
    const jitter = (Math.random() - 0.5) * 1.2 * proximityToEnd;
    point.x = Math.round(point.x + jitter);
    point.y = Math.round(point.y + jitter);

    const stepDistance = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    
    // Natural human pacing: gentle start and deceleration at destination
    const speedFactor = Math.sin(rawT * Math.PI) || 0.1;
    // Step delay between 12ms and 28ms (approx 1.0 - 1.8s per reach)
    const stepDelay = Math.max(10, Math.round(22 / (speedFactor + 0.35)));

    const velocity = stepDelay > 0 ? stepDistance / stepDelay : 0;

    trajectory.push({
      x: point.x,
      y: point.y,
      delayMs: stepDelay,
      velocity: parseFloat(velocity.toFixed(2)),
    });

    previousPoint = point;
  }

  return trajectory;
}
