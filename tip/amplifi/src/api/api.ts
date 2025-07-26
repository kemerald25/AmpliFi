// src/api.ts

// 1. CORRECTED IMPORTS
// We remove `FrameRequest` as it's not exported from the top level.
import { NeynarAPIClient, isApiErrorResponse } from "@neynar/nodejs-sdk";
import type { Request, Response } from "express";
import { ethers } from "ethers";

// --- ENVIRONMENT VARIABLES ---
if (!process.env.NEYNAR_API_KEY) throw new Error("NEYNAR_API_KEY is not set");
if (!process.env.NEYNAR_SIGNER_UUID)
  throw new Error("NEYNAR_SIGNER_UUID is not set");
if (!process.env.VITE_APP_URL) throw new Error("VITE_APP_URL is not set");

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const SIGNER_UUID = process.env.NEYNAR_SIGNER_UUID;
const APP_URL = process.env.VITE_APP_URL;

// --- CLIENTS & CONSTANTS ---
// This is the documented way to initialize the client.
const client = new NeynarAPIClient(NEYNAR_API_KEY);
const USDC_CONTRACT_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const TIP_COMMAND_REGEX = /\$TIP\s+(\d+(\.\d+)?)/i;

// --- 1. WEBHOOK LOGIC ---
export const webhook = async (req: Request, res: Response) => {
  console.log("Webhook received!");
  try {
    const cast = req.body.data;

    const match = cast.text.match(TIP_COMMAND_REGEX);
    if (!match || !cast.parent_hash) {
      return res.status(200).send("Not a valid tip command or not a reply.");
    }

    const tipAmount = parseFloat(match[1]);
    const parentHash = cast.parent_hash;

    const parentCastResponse = await client.lookupCastByHashOrUrl(parentHash);
    const recipient = parentCastResponse.cast.author;

    console.log(
      `Attempting tip: @${cast.author.username} -> @${recipient.username} ($${tipAmount})`
    );

    const state = {
      recipientFid: recipient.fid,
      tipAmount: tipAmount,
      recipientUsername: recipient.username,
    };
    const encodedState = Buffer.from(JSON.stringify(state)).toString(
      "base64url"
    );
    const frameUrl = `${APP_URL}/api/frame?state=${encodedState}`;

    // 2. CORRECTED `publishCast` METHOD
    // The method takes a single object with all parameters.
    await client.publishCast({
      signerUuid: SIGNER_UUID,
      text: `GM @${cast.author.username}! Please confirm your tip below.`,
      embeds: [{ url: frameUrl }],
      replyTo: cast.hash,
    });

    return res.status(200).send("Frame posted for confirmation.");
  } catch (e) {
    console.error("Webhook Error:", e);
    if (isApiErrorResponse(e)) {
      return res
        .status(500)
        .json({ message: e.message, details: e.response.data });
    }
    return res.status(500).send("Internal Server Error");
  }
};

// --- 2. FRAME GET LOGIC ---
export const getFrame = async (req: Request, res: Response) => {
  try {
    const state = req.query.state as string;
    if (!state) throw new Error("No state provided");

    const decodedState = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8")
    );
    const { recipientUsername, tipAmount } = decodedState;

    const imageUrl = `${APP_URL}/api/image/confirm?username=${encodeURIComponent(
      recipientUsername
    )}&amount=${tipAmount}`;

    const frameHtml = `
            <!DOCTYPE html><html><head><title>Confirm Tip</title>
                <meta property="fc:frame" content="vNext" />
                <meta property="fc:frame:image" content="${imageUrl}" />
                <meta property="fc:frame:state" content="${state}" />
                <meta property="fc:frame:button:1" content="Confirm Tip ✅" />
                <meta property="fc:frame:button:1:action" content="tx" />
                <meta property="fc:frame:button:1:target" content="${APP_URL}/api/transaction" />
                <meta property="fc:frame:button:2" content="Cancel" />
            </head></html>`;

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(frameHtml);
  } catch (e) {
    console.error("Get Frame Error:", e);
    res
      .status(500)
      .send(
        `<!DOCTYPE html><html><head><title>Error</title><meta property="fc:frame" content="vNext" /><meta property="fc:frame:image" content="${APP_URL}/error.png" /><meta property="fc:frame:button:1" content="Error" /></head></html>`
      );
  }
};

// --- 3. TRANSACTION FRAME LOGIC ---
export const transactionFrame = async (req: Request, res: Response) => {
  try {
    // We removed the `FrameRequest` type annotation from `req.body`
    const body = req.body;

    const validationResponse = await client.validateFrameAction(
      body.trustedData.messageBytes
    );

    if (!validationResponse.valid) {
      return res.status(400).json({ message: "Invalid frame action" });
    }

    const stateStr = validationResponse.action.cast.state.serialized;
    const decodedState = JSON.parse(
      Buffer.from(stateStr, "base64url").toString("utf8")
    );
    const { recipientFid, tipAmount } = decodedState;

    // 3. CORRECTED `fetchBulkUsers` ARGUMENT
    // The method expects an object with a `fids` array.
    const usersResponse = await client.fetchBulkUsers({ fids: [recipientFid] });
    const recipientUser = usersResponse.users[0];

    const recipientAddress = recipientUser?.verified_addresses.eth_addresses[0];
    if (!recipientUser || !recipientAddress) {
      throw new Error(`User FID ${recipientFid} has no verified address.`);
    }

    const amountInSmallestUnit = ethers.parseUnits(
      tipAmount.toString(),
      USDC_DECIMALS
    );
    const usdcInterface = new ethers.Interface([
      "function transfer(address to, uint256 amount)",
    ]);
    const calldata = usdcInterface.encodeFunctionData("transfer", [
      recipientAddress,
      amountInSmallestUnit,
    ]);

    res.status(200).json({
      chainId: "eip155:8453", // Base Mainnet
      method: "eth_sendTransaction",
      params: {
        abi: [],
        to: USDC_CONTRACT_ADDRESS_BASE,
        data: calldata,
        value: "0",
      },
    });
  } catch (e) {
    console.error("Transaction Frame Error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ message: `Error: ${message}` });
  }
};

// --- 4. DYNAMIC IMAGE GENERATION (Placeholder) ---
export const getConfirmImage = async (req: Request, res: Response) => {
  const { username, amount } = req.query;
  console.log(`Generating image for: @${username}, $${amount}`);
  res.redirect(302, `/confirm.png`);
};
