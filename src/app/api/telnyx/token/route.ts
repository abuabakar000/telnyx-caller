import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.TELNYX_API_KEY;
    const sipUsername = process.env.TELNYX_SIP_USERNAME;
    const sipPassword = process.env.TELNYX_SIP_PASSWORD;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'TELNYX_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    if (!sipUsername || !sipPassword) {
      return NextResponse.json(
        { error: 'TELNYX_SIP_USERNAME or TELNYX_SIP_PASSWORD is not configured.' },
        { status: 500 }
      );
    }

    console.log(`[Telnyx Token API] Fetching telephony credentials from Telnyx API...`);
    // 1. Fetch all telephony credentials
    const credsResponse = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 0 }, // Do not cache
    });

    if (!credsResponse.ok) {
      const errorText = await credsResponse.text();
      console.warn(`[Telnyx Token API] Failed to list telephony credentials:`, errorText);
      // Fall back to direct username/password login
      return NextResponse.json({
        token: null,
        login: sipUsername,
        password: sipPassword,
        fallback: true,
        reason: `Failed to fetch credentials list: ${credsResponse.statusText}`,
      });
    }

    const credsData = await credsResponse.json();
    console.log(`[Telnyx Token API] Retrieved ${credsData.data?.length || 0} credentials.`);

    // 2. Find credential matching the SIP Username
    const match = credsData.data?.find(
      (cred: { username?: string }) => cred.username === sipUsername
    );

    if (!match) {
      console.warn(`[Telnyx Token API] No telephony credential found matching username "${sipUsername}".`);
      // Fall back to direct username/password login
      return NextResponse.json({
        token: null,
        login: sipUsername,
        password: sipPassword,
        fallback: true,
        reason: 'No matching telephony credential found in list.',
      });
    }

    const credentialId = match.id;
    console.log(`[Telnyx Token API] Found credential ID: ${credentialId}. Requesting JWT token...`);

    // 3. Request JWT WebRTC token for this credential ID
    const tokenResponse = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credentialId}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      next: { revalidate: 0 },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.warn(`[Telnyx Token API] Failed to generate token for ID ${credentialId}:`, errorText);
      return NextResponse.json({
        token: null,
        login: sipUsername,
        password: sipPassword,
        fallback: true,
        reason: `Failed to generate token: ${tokenResponse.statusText}`,
      });
    }

    // Telnyx returns raw text token
    const tokenText = await tokenResponse.text();
    console.log(`[Telnyx Token API] Token generated successfully.`);

    return NextResponse.json({
      token: tokenText.trim(),
      login: null,
      password: null,
      fallback: false,
    });
  } catch (error: unknown) {
    console.error(`[Telnyx Token API] Exception:`, error);
    return NextResponse.json({
      token: null,
      login: process.env.TELNYX_SIP_USERNAME,
      password: process.env.TELNYX_SIP_PASSWORD,
      fallback: true,
      reason: error instanceof Error ? error.message : 'Unknown internal error',
    });
  }
}
