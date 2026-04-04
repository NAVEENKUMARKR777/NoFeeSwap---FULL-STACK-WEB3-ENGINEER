import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "..", "deployed-addresses.json");
    const data = fs.readFileSync(filePath, "utf8");
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json({ error: "deployed-addresses.json not found. Run deploy script first." }, { status: 404 });
  }
}
