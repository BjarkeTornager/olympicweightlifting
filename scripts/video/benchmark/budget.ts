export type Charge = {
  id: string;
  reserved: number;
  cost?: number;
};

export function committed(charges: Charge[]) {
  return charges.reduce((sum, c) => {
    const amount = c.cost ?? c.reserved;
    if (!Number.isFinite(amount) || amount < 0)
      throw Error("Invalid charge ledger");
    return sum + amount;
  }, 0);
}

export function reserve(
  charges: Charge[],
  id: string,
  amount: number,
  budget: number,
) {
  if (!Number.isFinite(budget) || budget <= 0 || budget > 10)
    throw Error("This evaluation is authorized for at most US$10");
  if (charges.some((c) => c.id === id))
    throw Error("Request already recorded; no automatic retries");
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    committed(charges) + amount > budget - 0.5
  )
    throw Error("Evaluation budget would be exceeded (US$0.50 safety margin)");
  charges.push({ id, reserved: amount });
}

export function settle(charges: Charge[], id: string, cost: unknown) {
  const charge = charges.find((c) => c.id === id);
  if (!charge || charge.cost !== undefined) throw Error("Invalid settlement");
  // On a timeout/missing usage the reservation remains spent until reconciled.
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
    throw Error(
      "Provider cost unavailable; reservation retained, evaluation stopped",
    );
  charge.cost = cost;
  if (cost > charge.reserved)
    throw Error("Provider exceeded reserved cost; stop evaluation");
}
