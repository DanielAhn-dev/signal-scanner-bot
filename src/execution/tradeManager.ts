export type Order = {
  id: string;
  qty: number;
  entryPrice: number;
  avgPrice?: number;
};

export type Position = {
  id: string;
  qty: number;
  avgPrice: number;
  stops: { trailing?: number; hard?: number };
};

export function applyPyramiding(position: Position | null, addOrder: Order, maxPyramidSteps = 3) {
  if (!position) {
    return { id: addOrder.id, qty: addOrder.qty, avgPrice: addOrder.entryPrice, stops: {} as any } as Position;
  }
  const existingSteps = Math.max(1, Math.ceil(position.qty / Math.max(1, addOrder.qty)));
  if (existingSteps >= maxPyramidSteps) return position; // reject further pyramiding

  const newQty = position.qty + addOrder.qty;
  const newAvg = (position.avgPrice * position.qty + addOrder.entryPrice * addOrder.qty) / newQty;
  return { ...position, qty: newQty, avgPrice: newAvg };
}

export function updateTrailingStop(position: Position, currentPrice: number, trailPct = 0.05) {
  const newTrail = currentPrice * (1 - trailPct);
  position.stops = position.stops || {};
  if (!position.stops.trailing || newTrail > position.stops.trailing) position.stops.trailing = newTrail;
  return position;
}

export default { applyPyramiding, updateTrailingStop };
