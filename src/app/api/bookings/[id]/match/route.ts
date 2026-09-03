// POST /api/bookings/[id]/match
// Manually re-runs the matching engine for a PENDING booking.
// Useful for the customer-facing UI when a booking hasn't yet been matched.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { matchRiderForBooking } from "@/lib/matching";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (booking.status !== "PENDING") {
    return NextResponse.json(
      { error: `Booking is already ${booking.status}.` },
      { status: 400 },
    );
  }

  const match = await matchRiderForBooking(
    booking.id,
    booking.vehicleClass as Parameters<typeof matchRiderForBooking>[1],
    { lat: booking.pickupLat, lng: booking.pickupLng },
  );

  if (!match) {
    return NextResponse.json(
      { matched: false, message: "No eligible riders nearby. Try again later." },
      { status: 200 },
    );
  }

  const updated = await db.booking.update({
    where: { id },
    data: {
      riderId: match.riderId,
      status: "MATCHED",
      matchedAt: new Date(),
    },
    include: {
      rider: {
        select: {
          id: true,
          name: true,
          phone: true,
          vehicleClass: true,
          vehiclePlate: true,
          lat: true,
          lng: true,
          rating: true,
        },
      },
    },
  });

  return NextResponse.json({ matched: true, booking: updated });
}
