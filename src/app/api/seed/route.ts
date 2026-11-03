import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hash } from "bcryptjs";

// One-time bootstrap endpoint.
//
// It used to be reachable by anyone and would create an admin account with a
// hard-coded password. It is now disabled unless the SEED_SECRET environment
// variable is set, and it then requires that secret to be supplied in the
// `x-seed-secret` header. Both the admin username and password come from the
// environment so no credentials are baked into the source.
export async function GET(request: NextRequest) {
	const seedSecret = process.env.SEED_SECRET;

	// Disabled unless explicitly configured.
	if (!seedSecret) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const provided = request.headers.get("x-seed-secret");
	if (!provided || provided !== seedSecret) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const adminUsername = process.env.SEED_ADMIN_USERNAME;
	const adminPassword = process.env.SEED_ADMIN_PASSWORD;

	if (!adminUsername || !adminPassword) {
		return NextResponse.json(
			{ error: "Seeding is not fully configured" },
			{ status: 500 }
		);
	}

	try {
		// Check if the admin user already exists
		const existingUser = await db.user.findUnique({
			where: { username: adminUsername },
		});

		if (existingUser) {
			return NextResponse.json(
				{ message: "Admin user already exists" },
				{ status: 200 }
			);
		}

		const hashedPassword = await hash(adminPassword, 10);

		const user = await db.user.create({
			data: {
				username: adminUsername,
				password_hash: hashedPassword,
				role: "admin",
				is_active: true,
			},
		});

		return NextResponse.json(
			{
				message: "Admin user created successfully",
				user: {
					id: user.id,
					username: user.username,
					role: user.role,
				},
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error("Error creating admin user:", error);
		return NextResponse.json(
			{ error: "Failed to create admin user" },
			{ status: 500 }
		);
	}
}
