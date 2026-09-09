const { PrismaClient } = require("../src/generated/prisma");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  try {
    // Get arguments from command line or use defaults
    const username = process.argv[2] || "admin";
    const password = process.argv[3] || "Admin@123";
    const role = process.argv[4] || "admin";

    console.log(`Creating user: ${username} with role: ${role}`);

    // Validate role
    if (!["admin", "staff"].includes(role)) {
      console.error('Role must be either "admin" or "staff"');
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      console.log(`User with username ${username} already exists.`);
      return;
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user
    const user = await prisma.user.create({
      data: {
        username,
        password_hash: hashedPassword,
        role,
        is_active: true,
      },
    });

    console.log(
      `✅ Created user with username: ${user.username} and role: ${user.role}`
    );
  } catch (error) {
    console.error("❌ Error creating user:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Show usage if no arguments provided
if (process.argv.length === 2) {
  console.log(
    "Usage: node create-user-with-args.js [username] [password] [role]"
  );
  console.log(
    "Example: node create-user-with-args.js john MyPassword123 staff"
  );
  console.log("Default: admin Admin@123 admin");
}

main();
