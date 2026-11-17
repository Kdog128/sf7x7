// Normalized desirability, not a dollar appraisal. Waterfront uses coastal proximity
// as a water-view proxy; parks and landmarks contribute through the amenity field.
const finite = (v) => Number.isFinite(v) ? v : 0;
const unit = (v) => Math.max(0, Math.min(1, finite(v)));

export function landValue({ activity = 0, amenity = 0, services = 0, transit = 0,
  water = 0, noise = 0, traffic = 0, industry = 0, highway = 0, heat = 0,
  enabled = true, simulatedTraffic = true } = {}) {
  if (!enabled) return 0.5;
  return unit(0.18 + 0.3 * unit(activity) + 0.22 * unit(amenity)
    + 0.16 * unit(services) + 0.12 * unit(transit) + Math.min(0.12, unit(water))
    - 0.3 * unit(noise) - (simulatedTraffic ? 0.12 * unit(traffic) : 0)
    - 0.14 * unit(industry) - 0.1 * unit(highway)
    + Math.max(-1, Math.min(1, finite(heat))) * 0.14);
}

// Extra development levels, still bounded by the zone and the available lot.
export function landValueBonus(value, enabled = true) {
  if (!enabled || !Number.isFinite(value)) return 0;
  return value >= 0.8 ? 2 : value >= 0.55 ? 1 : value < 0.16 ? -1 : 0;
}
