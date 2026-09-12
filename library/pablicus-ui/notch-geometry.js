/**
 * Web port of Codenotch SideNotchShape.canonicalPath / NotchPlacement.
 * Copyright (c) 2026 Vinz. MIT — see ./THIRD_PARTY_NOTICES.md.
 * Upstream bd62f4486a81a31e8239f79ae93f3370cb047b78.
 * Pablicus: SVG output, explicit bounds; platform/window APIs removed.
 */
export function notchPath(width, height, radius = 16, flare = 12) {
  if (![width, height, radius, flare].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RangeError('Notch requires finite positive dimensions');
  }
  const wanted = Math.max(0, Math.min(radius, width / 2));
  const curl = Math.max(0, Math.min(flare, height / 2, width - wanted));
  const corner = Math.max(0, Math.min(wanted, (height - 2 * curl) / 2));
  const bottom = height - curl;
  // SVG y runs down. Concave joins use sweep=1; convex inner corners use 0.
  return `M ${width} 0 A ${curl} ${curl} 0 0 1 ${width - curl} ${curl} ` +
    `L ${corner} ${curl} A ${corner} ${corner} 0 0 0 0 ${curl + corner} ` +
    `L 0 ${bottom - corner} A ${corner} ${corner} 0 0 0 ${corner} ${bottom} ` +
    `L ${width - curl} ${bottom} A ${curl} ${curl} 0 0 1 ${width} ${height} Z`;
}

export function edgePoint(edge, width, height, along, across) {
  switch (edge) {
    case 'right': return { x: width - across, y: along };
    case 'left': return { x: across, y: along };
    case 'top': return { x: along, y: across };
    case 'bottom': return { x: along, y: height - across };
    default: throw new RangeError('Unknown edge');
  }
}

export function clampPosition(position, available, extent, margin = 12) {
  return Math.min(Math.max(position, margin), Math.max(margin, available - extent - margin));
}
