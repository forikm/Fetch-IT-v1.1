// /api/bookings/[id]
// GET    — fetch a single booking (with customer / rider / proofs / latest tracking).
// PATCH  — rider updates the booking status (ACCEPTED | PICKED_UP | IN_TRANSIT | DELIVERED).
//          Each transition also timestamps the appropriate field and updates ETA.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  BOOKING_STATUS_FLOW,
  type BookingStatus,
  VEHICLES,
} from "@/lib/constants";
import { etaMinutes } from "@/lib/fare";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
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
          totalDeliveries: true,
        },
      },
      trackingUpdates: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      deliveryProofs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (
    session.role === "CUSTOMER" &&
    booking.customerId !== session.uid
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.role === "RIDER" && booking.riderId !== session.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ booking });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const { status } = (await req.json()) as { status: BookingStatus };

    if (!BOOKING_STATUS_FLOW.includes(status) && status !== "CANCELLED") {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }

    // Only the assigned rider may advance the status (except CANCELLED which
    // is open to the customer via a separate route).
    if (session.role === "RIDER") {
      if (booking.riderId !== session.uid) {
        return NextResponse.json(
          { error: "You are not assigned to this booking." },
          { status: 403 },
        );
      }
    } else if (session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only the assigned rider may change status." },
        { status: 403 },
      );
    }

    const now = new Date();
    const updates: Record<string, unknown> = { status };

    if (status === "ACCEPTED") updates.matchedAt ??= now;
    if (status === "PICKED_UP") updates.pickedUpAt = now;
    if (status === "DELIVERED") updates.deliveredAt = now;

    // Recompute ETA using distance-based estimate when rider starts moving.
    if (status === "ACCEPTED" || status === "IN_TRANSIT") {
      const v = VEHICLES[booking.vehicleClass as keyof typeof VEHICLES];
      if (v) {
        updates.etaMinutes = etaMinutes(booking.distanceKm, v.speedKph);
      }
    }

    const updated = await db.booking.update({
      where: { id },
      data: updates,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
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

    // On DELIVERED, increment rider stats.
    if (status === "DELIVERED" && updated.riderId) {
      await db.user.update({
        where: { id: updated.riderId },
        data: { totalDeliveries: { increment: 1 } },
      });
    }

    return NextResponse.json({ booking: updated });
  } catch (err) {
    console.error("[bookings/[id] PATCH] error", err);
    return NextResponse.json(
      { error: "Failed to update booking." },
      { status: 500 },
    );
  }
}
