// supabase/functions/random-word-image/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const PEXELS_API_KEY = Deno.env.get("PEXELS_API_KEY")!;
const PIXABAY_API_KEY = Deno.env.get("PIXABAY_API_KEY")!;
const FLICKR_API_KEY = Deno.env.get("FLICKR_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info",  // Common Supabase headers
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: corsHeaders });
  }

  try {
    const { letter, width = 300, height = 300, source = "pexels" } = await req.json();

    if (!letter || typeof letter !== "string" || letter.length !== 1) {
      return new Response(JSON.stringify({ error: "Invalid letter" }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const wordApiUrl = `https://api.datamuse.com/words?sp=${letter.toLowerCase()}*&max=20`;
    const wordRes = await fetch(wordApiUrl);
    const wordList = await wordRes.json();

    if (!Array.isArray(wordList) || wordList.length === 0) {
      return new Response(JSON.stringify({ error: "No word found for letter" }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const word = wordList[Math.floor(Math.random() * wordList.length)].word;
    let image_url = "";

    switch (source) {
      case "pexels": {
        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${word}&per_page=1`,
          { headers: { Authorization: PEXELS_API_KEY } },
        );
        const json = await res.json();
        image_url = json.photos?.[0]?.src?.medium || "";
        break;
      }
      case "pixabay": {
        const res = await fetch(
          `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(word)}&image_type=photo&per_page=3`,
        );
        const json = await res.json();
        image_url = json.hits?.[0]?.webformatURL || "";
        break;
      }
      case "openverse": {
        const res = await fetch(
          `https://api.openverse.engineering/v1/images?q=${encodeURIComponent(word)}&page_size=1`,
        );
        const json = await res.json();
        image_url = json.results?.[0]?.url || "";
        break;
      }
      case "flickr": {
        const res = await fetch(
          `https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=${FLICKR_API_KEY}&text=${encodeURIComponent(word)}&format=json&nojsoncallback=1&per_page=1`,
        );
        const json = await res.json();
        const photo = json.photos?.photo?.[0];
        if (photo) {
          image_url = `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_w.jpg`;
        }
        break;
      }
      case "lorem_picsum": {
        image_url = `https://picsum.photos/seed/${word}/${width}/${height}`;
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Invalid image source" }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        });
    }

    if (!image_url) {
      return new Response(JSON.stringify({ error: "Image not found for word" }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    return new Response(JSON.stringify({ word, image_url }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      status: 200,
    });
  } catch (err) {
    console.error("ERROR:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
