import "dotenv/config";
import express, { type Request, type Response } from "express";
import { MongoClient, ObjectId, type Collection } from "mongodb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error("MONGODB_URI is missing from .env");
}

interface Pokemon {
  _id: number | ObjectId;
  name: string;
  type: string[];
  category: string;
  height: number;
  weight: number;
  ability: string[];
  img?: string;
}

type PokemonInput = Partial<Pokemon> & { _id?: unknown };
type ValidationResult = { value: Partial<Pokemon> } | { error: string };

const validTypes = [
  "bug", "dark", "dragon", "electric", "fairy", "fight",
  "fire", "flying", "ghost", "grass", "ground", "ice",
  "normal", "poison", "psychic", "rock", "steel", "water"
] as const;

function validatePokemon(data: unknown, partial = false): ValidationResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Send a JSON object." };
  }

  const input = data as Record<string, unknown>;
  const rules: Record<string, (value: unknown) => boolean> = {
    _id: value => Number.isSafeInteger(value) && Number(value) > 0,
    name: value => typeof value === "string" && value.length <= 80 && /^[A-Za-z0-9_-]+$/.test(value) && !/[\r\n]/.test(value),
    type: value => Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(item => validTypes.includes(item)),
    category: value => typeof value === "string" && value.trim().length > 0 && value.length <= 120,
    height: value => typeof value === "number" && Number.isFinite(value) && value > 0,
    weight: value => typeof value === "number" && Number.isFinite(value) && value > 0,
    ability: value => Array.isArray(value) && value.length >= 1 && value.length <= 10 && value.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 100),
    img: value => typeof value === "string" && /^img\/[A-Za-z0-9_-]+\.webp$/.test(value) && !/[\r\n]/.test(value)
  };

  const fields = Object.keys(input);
  if (fields.length === 0) return { error: "Send at least one field." };

  for (const field of fields) {
    if (partial && field === "_id") return { error: "The Pokédex number cannot be changed." };
    if (!Object.hasOwn(rules, field)) return { error: `Unknown field: ${field}` };
    if (!rules[field](input[field])) return { error: `Invalid value for ${field}` };
  }

  if (!partial) {
    for (const field of ["_id", "name", "type", "category", "height", "weight", "ability"]) {
      if (!Object.hasOwn(input, field)) return { error: `Missing field: ${field}` };
    }
  }

  return { value: input as Partial<Pokemon> };
}

function parsePokemonId(id: string): number | ObjectId | null {
  if (/^[1-9][0-9]*$/.test(id)) {
    const number = Number(id);
    if (Number.isSafeInteger(number)) return number;
  }
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const client = new MongoClient(mongoUri);

async function startServer(): Promise<void> {
  try {
    await client.connect();
    console.log("Connected to MongoDB Atlas!");

    const collection: Collection<Pokemon> = client.db("PokemonDB").collection<Pokemon>("Pokemons");

    app.get("/api/Pokemons", async (_req: Request, res: Response) => {
      try {
        res.json(await collection.find().toArray());
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to retrieve Pokemon" });
      }
    });

    app.post("/api/Pokemons", async (req: Request, res: Response) => {
      try {
        const checked = validatePokemon(req.body);
        if ("error" in checked) return res.status(400).json({ error: checked.error });

        const pokemon = checked.value as Pokemon;
        const result = await collection.insertOne(pokemon);
        res.status(201).json({ message: "Pokemon added successfully!", id: result.insertedId });
      } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
          return res.status(409).json({ error: "That Pokédex number already exists. Choose a different number." });
        }
        console.error(error);
        res.status(500).json({ error: "Failed to add Pokemon" });
      }
    });

    app.patch("/api/Pokemons/:id",async (req: Request<{ id: string }>, res: Response) => {
      try {
        const databaseId = parsePokemonId(req.params.id);
        if (databaseId === null) return res.status(400).json({ error: "Invalid pokemon id" });

        const checked = validatePokemon(req.body, true);
        if ("error" in checked) return res.status(400).json({ error: checked.error });
        if (Object.keys(checked.value).length === 0) return res.status(400).json({ error: "No valid fields to update" });

        const result = await collection.updateOne({ _id: databaseId }, { $set: checked.value });
        if (result.matchedCount === 0) return res.status(404).json({ error: "Pokemon not found" });
        res.json({ message: "Pokemon updated successfully!", modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to update pokemon" });
      }
    });

    app.delete("/api/Pokemons/:id", async (req: Request<{ id: string }>, res: Response) => {
      try {
        const databaseId = parsePokemonId(req.params.id);
        if (databaseId === null) return res.status(400).json({ error: "invalid Pokemon ID" });

        const result = await collection.deleteOne({ _id: databaseId });
        if (result.deletedCount === 0) return res.status(404).json({ error: "Pokemon not found" });
        res.json({ message: "Pokemon deleted successfully!", deletedCount: result.deletedCount });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to delete Pokemon" });
      }
    });

    app.get("/", (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "../public/search.html"));
    });

    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  } catch (error) {
    console.error("Connection failed:", error);
    await client.close();
    process.exitCode = 1;
  }
}

void startServer();
