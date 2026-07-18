import { PrismaClient, ExerciseCategory, MuscleGroup } from 'generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// A standalone PrismaClient here (not the Nest-wired PrismaService) is
// intentional — this script runs outside the Nest application context via
// `prisma db seed` / `npx prisma db seed`, so there's no DI container to
// inject into. It gets its own short-lived connection, used once, then
// closed.
const connectionString = process.env.DATABASE_URL
const prisma = new PrismaClient({ adapter: new PrismaPg({connectionString})});

interface ExerciseSeed {
  name: string;
  description: string;
  category: ExerciseCategory;
  muscleGroup: MuscleGroup;
}

async function main() {
  const filePath = join(__dirname, 'seed-data', 'exercises.json');
  const raw = readFileSync(filePath, 'utf-8');
  const exercises: ExerciseSeed[] = JSON.parse(raw);

  console.log(`Seeding ${exercises.length} exercises...`);

  // upsert (not create) keyed on the unique `name` field: this makes the
  // seeder IDEMPOTENT — safe to re-run any number of times (e.g. after
  // pulling changes to exercises.json) without throwing unique-constraint
  // errors or creating duplicates. Existing rows get their fields synced
  // to match the JSON; new entries get created.
  for (const exercise of exercises) {
    await prisma.exercise.upsert({
      where: { name: exercise.name },
      update: {
        description: exercise.description,
        category: exercise.category,
        muscleGroup: exercise.muscleGroup,
      },
      create: exercise,
    });
  }

  const total = await prisma.exercise.count();
  console.log(`Done. Exercise catalog now has ${total} entries.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
