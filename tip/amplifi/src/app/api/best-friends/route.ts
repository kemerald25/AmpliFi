import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const apiKey = process.env.NEYNAR_API_KEY;
  const { searchParams } = new URL(request.url);
  const fid = searchParams.get('fid');
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Neynar API key is not configured. Please add NEYNAR_API_KEY to your environment variables.' },
      { status: 500 }
    );
  }

  if (!fid) {
    return NextResponse.json(
      { error: 'FID parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Try the best_friends endpoint first
    let response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/best_friends?fid=${fid}&limit=3`,
      {
        headers: {
          "x-api-key": apiKey,
        },
      }
    );

    // If best_friends is not available (402 Payment Required), fall back to followers
    if (response.status === 402) {
      console.log('Best friends endpoint requires payment, falling back to recent followers...');
      
      // Get user's recent followers instead
      response = await fetch(
        `https://api.neynar.com/v1/farcaster/followers?fid=${fid}&limit=3`,
        {
          headers: {
            "x-api-key": apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Neynar API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Transform the followers data to match expected format
      const users = data.result?.followers?.map((follower: any) => ({
        user: {
          fid: follower.fid,
          username: follower.username
        }
      })) || [];

      return NextResponse.json({ 
        bestFriends: users.slice(0, 3),
        note: 'Showing recent followers instead of best friends (premium feature)'
      });
    }

    if (!response.ok) {
      throw new Error(`Neynar API error: ${response.statusText}`);
    }

    const { users } = await response.json() as { users: { user: { fid: number; username: string } }[] };

    return NextResponse.json({ bestFriends: users });
  } catch (error) {
    console.error('Failed to fetch best friends:', error);
    
    // Try one more fallback - get user's following list
    try {
      console.log('Trying following list as final fallback...');
      
      const fallbackResponse = await fetch(
        `https://api.neynar.com/v1/farcaster/following?fid=${fid}&limit=3`,
        {
          headers: {
            "x-api-key": apiKey,
          },
        }
      );

      if (fallbackResponse.ok) {
        const data = await fallbackResponse.json();
        const users = data.result?.following?.map((following: any) => ({
          user: {
            fid: following.fid,
            username: following.username
          }
        })) || [];

        return NextResponse.json({ 
          bestFriends: users.slice(0, 3),
          note: 'Showing recent follows instead of best friends (premium feature)'
        });
      }
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
    }

    return NextResponse.json(
      { 
        error: 'Failed to fetch best friends. This feature may require a premium Neynar API plan.',
        suggestion: 'Consider upgrading your Neynar plan or using alternative endpoints.'
      },
      { status: 500 }
    );
  }
}