// Auto-match engine — picks the nearest online rider whose vehicle class
// matches the booking's vehicle class and whose current load allows it.
// Returns null if no eligible rider is available.

import { db } from "@/lib/db";
import { haversineKm } from "@/lib/fare";
import type { VehicleClass } from "@/lib/constants";

export async function matchRiderForBooking(
  bookingId: string,
  vehicleClass: VehicleClass,
  pickup: { lat: number; lng: number },
): Promise<{ riderId: string; distanceKm: number } | null> {
  const candidates = await db.user.findMany({
    where: {
      role: "RIDER",
      isOnline: true,
      vehicleClass,
      // Excludes riders already actively delivering a booking
      bookingsAsRider: {
        none: {
          status: { in: ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"] },
        },
      },
    },
  });

  if (candidates.length === 0) return null;

  let best: { riderId: string; distanceKm: number } | null = null;
  for (const r of candidates) {
    if (r.lat == null || r.lng == null) continue;
    const d = haversineKm(pickup, { lat: r.lat, lng: r.lng });
    if (!best || d < best.distanceKm) {
      best = { riderId: r.id, distanceKm: d };
    }
  }
  return best;
}
