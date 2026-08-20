import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

/**
 * Builds an authenticated Graph client using app-only (client credentials)
 * auth — no user sign-in needed, suitable for an unattended nightly job.
 */
export function buildGraphClient() {
  const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID,
    process.env.AZURE_CLIENT_ID,
    process.env.AZURE_CLIENT_SECRET
  );

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken("https://graph.microsoft.com/.default");
        return token.token;
      },
    },
  });
}

// Real layout confirmed (Aug 2026): all properties' files sit in one shared
// folder per financial year, not a per-property subfolder. Every active FY
// folder is checked — a property's file might be in the current or prior FY
// folder depending on when it was last touched.
const DATABASE_FOLDERS = ["Databases/FY 26-27", "Databases/FY 25-26"];

/**
 * Lists every .xlsx file across the known Databases/FY-year folders whose
 * filename contains the property's configured match string (from
 * property_master.sharepoint_filename_match), most-recently-modified first.
 *
 * Returns [{ id, name, lastModifiedDateTime, size, downloadUrl }]
 */
export async function listPropertyFiles(graphClient, driveId, filenameMatch) {
  const allMatches = [];

  for (const folder of DATABASE_FOLDERS) {
    let items;
    try {
      const path = `/drives/${driveId}/root:/${folder}:/children`;
      const res = await graphClient.api(path).get();
      items = res.value || [];
    } catch (err) {
      // A missing FY folder (e.g. next year's not created yet) shouldn't
      // fail the whole property — just skip it.
      if (err.statusCode === 404) continue;
      throw err;
    }

    const matches = items
      .filter(
        (item) =>
          item.file &&
          item.name.toLowerCase().endsWith(".xlsx") &&
          item.name.toLowerCase().includes(filenameMatch.toLowerCase())
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        lastModifiedDateTime: item.lastModifiedDateTime,
        size: item.size,
        downloadUrl: item["@microsoft.graph.downloadUrl"],
      }));

    allMatches.push(...matches);
  }

  allMatches.sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
  return allMatches;
}

/**
 * Downloads a file's raw bytes given its Graph download URL.
 * Returns a Buffer, ready to hand to the xlsx parser.
 */
export async function downloadFile(downloadUrl) {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Sends an HTML email via Microsoft Graph's application-permission mail
 * send endpoint. App-only auth has no signed-in user, so it sends "as" the
 * mailbox given in `from` — that mailbox needs to exist and the Azure AD
 * app needs the Mail.Send application permission (see .env.example).
 */
export async function sendMail(graphClient, { from, to, subject, html }) {
  const toRecipients = String(to || "")
    .split(",")
    .map((addr) => addr.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

  if (toRecipients.length === 0) {
    throw new Error("sendMail: no recipients — set ALERT_EMAIL_TO in .env");
  }
  if (!from) {
    throw new Error("sendMail: no sender mailbox — set ALERT_EMAIL_FROM in .env");
  }

  await graphClient.api(`/users/${from}/sendMail`).post({
    message: {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients,
    },
    saveToSentItems: "false",
  });
}
