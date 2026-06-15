import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const apiKey = process.env.TELNYX_API_KEY && process.env.TELNYX_API_KEY.includes('_')
      ? process.env.TELNYX_API_KEY
      : (process.env.TELNYX_CALL_API_KEY || process.env.TELNYX_API_KEY);
    const telnyxNumber = process.env.NEXT_PUBLIC_TELNYX_NUMBER;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'TELNYX_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    // 1. Fetch Account Balance
    console.log('[Telnyx Status API] Fetching account balance...');
    const balanceResponse = await fetch('https://api.telnyx.com/v2/balance', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 0 },
    });

    let balanceData = null;
    if (balanceResponse.ok) {
      const data = await balanceResponse.json();
      balanceData = data.data;
    } else {
      console.warn('[Telnyx Status API] Failed to fetch balance:', balanceResponse.statusText);
    }

    // 2. Fetch Phone Number Config / Health (only if number is configured)
    let numberDetails = null;
    let numberHealth = 'unknown';

    if (telnyxNumber) {
      // Clean number to search (Telnyx API stores them in E.164, e.g. +16396362350)
      const cleanSearchNum = telnyxNumber.trim().startsWith('+') 
        ? telnyxNumber.trim() 
        : `+${telnyxNumber.trim()}`;

      console.log(`[Telnyx Status API] Querying phone number details for: ${cleanSearchNum}`);
      const numbersResponse = await fetch(`https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(cleanSearchNum)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        next: { revalidate: 0 },
      });

      if (numbersResponse.ok) {
        const numbersData = await numbersResponse.json();
        const numList = numbersData.data || [];
        if (numList.length > 0) {
          const matchedNum = numList[0];
          numberDetails = {
            id: matchedNum.id,
            phone_number: matchedNum.phone_number,
            status: matchedNum.status,
            connection_id: matchedNum.connection_id,
            billing_group_id: matchedNum.billing_group_id,
          };

          // Determine health based on connection configuration
          if (matchedNum.status === 'active') {
            if (matchedNum.connection_id) {
              numberHealth = 'healthy';
            } else {
              numberHealth = 'unconfigured'; // Active but not bound to any connection/SIP profile
            }
          } else {
            numberHealth = 'inactive';
          }
        } else {
          numberHealth = 'not_found'; // Number not in this account list
        }
      } else {
        console.warn('[Telnyx Status API] Failed to fetch number details:', numbersResponse.statusText);
      }
    }

    return NextResponse.json({
      balance: balanceData?.balance || '0.00',
      currency: balanceData?.currency || 'USD',
      creditLimit: balanceData?.credit_limit || '0.00',
      availableCredit: balanceData?.available_credit || '0.00',
      number: telnyxNumber || null,
      numberStatus: numberDetails?.status || 'unknown',
      numberHealth: numberHealth,
      connectionId: numberDetails?.connection_id || null,
    });
  } catch (error: any) {
    console.error('[Telnyx Status API] Exception:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
