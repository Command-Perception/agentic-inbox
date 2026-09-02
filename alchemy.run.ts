import * as emailRouting from "@distilled.cloud/cloudflare/email-routing";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type { EmailAgent, EmailMCP, MailboxDO } from "./workers/app.ts";

const SetupInboundDns = Alchemy.Action(
	"SetupInboundDns",
	Effect.fn(function* (input: { zoneId: string; name: string }) {
		return yield* emailRouting.createDns({
			zoneId: input.zoneId,
			name: input.name,
		});
	}),
);

export const Attachments = Cloudflare.R2.Bucket("Attachments", {
	name: "agentic-inbox",
});

export const EmailBinding = Cloudflare.Email.SendEmail("Email");

export default Alchemy.Stack(
	"AgenticInbox",
	{
		providers: Cloudflare.providers(),
		// Local state avoids Secrets Store auth required by Cloudflare.state().
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const zoneId = yield* Config.string("CLOUDFLARE_ZONE_ID");
		const inboxHostname = yield* Config.string("INBOX_HOSTNAME").pipe(
			Config.withDefault("agent-inbox.codetek.us"),
		);
		const mailDomain = yield* Config.string("MAIL_DOMAIN").pipe(
			Config.withDefault("agent-inbox.codetek.us"),
		);

		const enableEmailRouting = yield* Config.boolean("ENABLE_EMAIL_ROUTING").pipe(
			Config.withDefault(false),
		);

		const inbox = yield* Cloudflare.Website.Vite("Inbox", {
			name: "agenticinbox-inbox-prod-ivwivydghgqeuylv",
			main: "workers/app.ts",
			compatibility: {
				date: "2025-11-28",
				flags: ["nodejs_compat"],
			},
			domain: {
				name: inboxHostname,
				zoneId,
			},
			access: {
				policies: [
					{
						decision: "allow",
						include: [
							{ email: "lkrenek@gmail.com" },
							{ email: "kykrenek@gmail.com" },
							{ email: "likren@gmail.com" },
						],
					},
				],
			},
			env: {
				DOMAINS: mailDomain,
				EMAIL_ADDRESSES: [] as string[],
				BUCKET: Attachments,
				AI: Cloudflare.Workers.AI(),
				EMAIL: EmailBinding,
				MAILBOX: Cloudflare.DurableObject<MailboxDO>("MAILBOX", {
					className: "MailboxDO",
				}),
				EMAIL_AGENT: Cloudflare.DurableObject<EmailAgent>("EMAIL_AGENT", {
					className: "EmailAgent",
				}),
				EMAIL_MCP: Cloudflare.DurableObject<EmailMCP>("EMAIL_MCP", {
					className: "EmailMCP",
				}),
				POLICY_AUD: Config.redacted("POLICY_AUD"),
				TEAM_DOMAIN: Config.redacted("TEAM_DOMAIN"),
			},
		});

		if (enableEmailRouting) {
			const routing = yield* Cloudflare.Email.Routing("Routing", { zone: zoneId });

			yield* SetupInboundDns({ zoneId: routing.zoneId, name: mailDomain });

			yield* Cloudflare.Email.CatchAll("CatchAll", {
				zone: routing.zoneId,
				name: "agentic-inbox catch-all",
				actions: [{ type: "worker", value: [inbox.workerName] }],
			});
		}

		return {
			url: inbox.url,
			workerName: inbox.workerName,
		};
	}),
);
