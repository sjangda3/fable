import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return response({ message: "Use POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!,
      serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = request.headers
      .get("Authorization")
      ?.replace(/^Bearer /i, "");
    if (!token)
      return response({ message: "Sign in to sync.", code: "AUTH" }, 401);
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token);
    if (authError || !user)
      return response(
        { message: "Your sync session expired. Sign in again.", code: "AUTH" },
        401,
      );
    let sessionId: string;
    try {
      sessionId = JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ).session_id;
    } catch {
      return response({ message: "Invalid session.", code: "AUTH" }, 401);
    }
    if (!uuid(sessionId))
      return response(
        { message: "A user session is required.", code: "AUTH" },
        401,
      );
    const body = await request.json();
    if (body.protocol !== 1)
      return response(
        {
          message: "Update Fable to sync with this server.",
          code: "UNSUPPORTED",
        },
        426,
      );
    if (!uuid(body.vaultId) || !uuid(body.deviceId))
      return response(
        { message: "Invalid vault or device identity.", code: "VALIDATION" },
        400,
      );
    const identity = {
      p_user: user.id,
      p_session: sessionId,
      p_vault: body.vaultId,
      p_device: body.deviceId,
    };
    const rpc = async (name: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await admin.rpc(name, { ...identity, ...args });
      if (error) throw new Error(error.message);
      return data;
    };
    if (body.action === "register") {
      if (typeof body.name !== "string" || body.name.length > 160)
        return response({ message: "Invalid device name." }, 400);
      await rpc("fable_register", { p_name: body.name });
      return response({ registered: true });
    }
    await rpc("fable_authorize");
    if (body.action === "prepare") {
      if (
        !uuid(body.revisionId) ||
        !Number.isSafeInteger(body.bytes) ||
        body.bytes < 1 ||
        body.bytes > 104857600
      )
        return response(
          { message: "This encrypted file is too large.", code: "QUOTA" },
          413,
        );
      // Reservations count toward quota until their uploaded blobs are deleted.
      // Signed upload tokens last two hours; the extra ten minutes avoids a token/delete race.
      const { data: expired } = await admin
        .from("fable_uploads")
        .select("revision_id,blob_path")
        .eq("owner_id", user.id)
        .lt("expires_at", new Date(Date.now() - 600000).toISOString())
        .limit(100);
      if (expired?.length) {
        const { error: removeError } = await admin.storage
          .from("encrypted-vaults")
          .remove(expired.map((r) => r.blob_path));
        if (!removeError)
          await admin
            .from("fable_uploads")
            .delete()
            .eq("owner_id", user.id)
            .in(
              "revision_id",
              expired.map((r) => r.revision_id),
            );
      }
      const uploadPath = await rpc("fable_prepare", {
        p_revision: body.revisionId,
        p_bytes: body.bytes,
      });
      const { data, error } = await admin.storage
        .from("encrypted-vaults")
        .createSignedUploadUrl(uploadPath);
      if (error) throw error;
      return response({ uploadPath, token: data.token });
    }
    if (body.action === "push") {
      if (
        !uuid(body.revisionId) ||
        (body.parent !== null && !uuid(body.parent)) ||
        typeof body.objectId !== "string" ||
        body.objectId.length > 200 ||
        body.blobPath !== `${user.id}/${body.vaultId}/${body.revisionId}`
      )
        return response(
          { message: "Invalid revision.", code: "VALIDATION" },
          400,
        );
      const { data: info, error } = await admin.storage
        .from("encrypted-vaults")
        .info(body.blobPath);
      if (error) throw error;
      const sequence = await rpc("fable_push", {
        p_object: body.objectId,
        p_revision: body.revisionId,
        p_parent: body.parent,
        p_blob: body.blobPath,
        p_bytes: info.size,
      });
      return response({ sequence });
    }
    if (body.action === "pull" || body.action === "manifest") {
      if (body.action === "manifest") {
        const { data, error } = await admin
          .from("fable_heads")
          .select("object_id,revision_id")
          .eq("vault_id", body.vaultId);
        if (error) throw error;
        return response({ heads: data });
      }
      const after = Number(body.after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0)
        return response({ message: "Invalid sync cursor." }, 400);
      const { data, error } = await admin
        .from("fable_revisions")
        .select("revision_id,object_id,parent_revision,sequence,blob_path")
        .eq("vault_id", body.vaultId)
        .gt("sequence", after)
        .order("sequence")
        .limit(100);
      if (error) throw error;
      return response({
        revisions: data,
        cursor: data.length ? data[data.length - 1].sequence : after,
      });
    }
    if (body.action === "ack") {
      const cursor = Number(body.cursor);
      if (!Number.isSafeInteger(cursor) || cursor < 0)
        return response({ message: "Invalid acknowledgment." }, 400);
      const { data: vault } = await admin
        .from("fable_vaults")
        .select("next_sequence")
        .eq("id", body.vaultId)
        .single();
      if (!vault || cursor > vault.next_sequence)
        return response(
          { message: "Acknowledgment is ahead of the vault." },
          400,
        );
      const { error } = await admin
        .from("fable_devices")
        .update({
          acknowledged_sequence: cursor,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", body.deviceId)
        .eq("vault_id", body.vaultId);
      if (error) throw error;
      return response({ acknowledged: true });
    }
    if (body.action === "devices") {
      const { data, error } = await admin
        .from("fable_devices")
        .select("id,name,revoked_at")
        .eq("vault_id", body.vaultId)
        .order("created_at");
      if (error) throw error;
      return response({
        devices: data.map((d) => ({
          id: d.id,
          name: d.name,
          current: d.id === body.deviceId,
          revoked: !!d.revoked_at,
        })),
      });
    }
    if (body.action === "revoke") {
      if (!uuid(body.id))
        return response({ message: "Invalid device identity." }, 400);
      await rpc("fable_revoke", { p_target: body.id });
      return response({ revoked: true });
    }
    return response(
      { message: "Unknown sync operation.", code: "VALIDATION" },
      400,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    if (message.includes("HEAD_MISMATCH"))
      return response(
        {
          message:
            "Another device changed this file. Pull and merge before retrying.",
          code: "HEAD_MISMATCH",
        },
        409,
      );
    if (/ACCESS_DENIED|DEVICE_REVOKED/.test(message))
      return response(
        {
          message:
            "This device no longer has access. Reconnect from sync settings.",
          code: "AUTH",
        },
        403,
      );
    if (/QUOTA|FILE_TOO_LARGE|UPLOADS_PENDING/.test(message))
      return response(
        {
          message:
            "The sync storage or upload limit was reached. Your local files are safe.",
          code: "QUOTA",
        },
        413,
      );
    // Never return upstream errors containing configuration or storage credentials.
    return response(
      {
        message:
          "The sync operation failed. Your local files are safe; try again.",
        code: "SYNC",
      },
      500,
    );
  }
});
