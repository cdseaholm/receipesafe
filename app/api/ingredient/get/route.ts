import Ingredient from '@/models/ingredient';
import connectDB from '@/lib/mongodb';
import { NextResponse } from 'next/server';
export async function GET() {
    try {
        await connectDB();
        const ingredients = await Ingredient.find().select('_id ingredient').sort({ ingredient: 1 }).lean();
        return NextResponse.json({ status: 200, ingredients });
    } catch { return NextResponse.json({ status: 500, ingredients: [] }, { status: 500 }); }
}
