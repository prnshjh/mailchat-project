import { auth } from "@clerk/nextjs/server";
import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { getAccountDetails, getAurinkoToken } from "~/lib/aurinko";
import { db } from "~/server/db";
import { waitUntil } from "@vercel/functions";

export const GET = async (req: NextRequest) => {
  try {
    const { userId } = await auth();
    if (!userId) {
      console.error("No userId found");
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const params = req.nextUrl.searchParams;
    const status = params.get("status");
    
    console.log("Callback params:", { status, code: params.get("code") });
    
    if (status !== "success") {
      console.error("Status is not success:", status);
      return NextResponse.json(
        { error: "Account connection failed" },
        { status: 400 },
      );
    }

    const code = params.get("code");
    if (!code) {
      console.error("No code in callback");
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    console.log("Exchanging code for token...");
    const token = await getAurinkoToken(code as string);
    
    if (!token) {
      console.error("Failed to get token from Aurinko");
      return NextResponse.json(
        { error: "Failed to fetch token" },
        { status: 400 },
      );
    }

    console.log("Token received, accountId:", token.accountId);
    
    const accountId = token.accountId.toString();
    
    console.log("Getting account details...");
    const accountDetails = await getAccountDetails(token.accessToken);
    console.log("Account details:", accountDetails);

    const user = await db.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      console.error("User not found in database:", userId);
      return NextResponse.json({ error: "No user found" }, { status: 404 });
    }

    console.log("Upserting account...");
    await db.account.upsert({
      where: { id: token.accountId.toString() },
      create: {
        id: accountId,
        userId,
        token: token.accessToken,
        provider: "Aurinko",
        emailAddress: accountDetails.email,
        name: accountDetails.name,
      },
      update: {
        token: token.accessToken,
      },
    });

    console.log("Account upserted successfully");

    // Start initial sync in background
    waitUntil(
      axios
        .post(`${process.env.NEXT_PUBLIC_URL}/api/initial-sync`, {
          accountId: token.accountId.toString(),
          userId,
        })
        .then(() => console.log("Initial sync started"))
        .catch((err) => {
          console.error("Initial sync error:", err.response?.data || err.message);
        }),
    );

    return NextResponse.redirect(new URL("/mail", req.url));
  } catch (error: any) {
    console.error("Callback route error:", error);
    console.error("Error stack:", error.stack);
    return NextResponse.json(
      { error: "Account connection failed", details: error.message },
      { status: 500 },
    );
  }
};