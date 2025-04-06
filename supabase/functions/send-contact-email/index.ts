import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("OK", {
      headers: corsHeaders,
    });
  }
  try {
    const { name, email, subject, message } = await req.json();

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response("Missing Resend API key", { status: 500 });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Rama <rama@cloudnotes.click>",
        to: "ramaeon.dev@gmail.com",
        cc: [email],
        subject: `New message from ${name}: ${subject}`,
        html: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(result);
      return new Response("Failed to send email", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({ message: "Email sent successfully!" }),
      {
        headers: { "Content-Type": "application/json",
          ...corsHeaders,
         },
        status: 200,
      },
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response("Unexpected error occurred", {
      status: 500,
      headers: corsHeaders,
    });
  }
});
