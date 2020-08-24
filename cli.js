#!/usr/bin/env node
// @ts-check
const sade = require("sade");
const { join, resolve } = require("path");
const { readFileSync, existsSync } = require("fs");

const { getSubResources } = require("./index.js");

const { version } = JSON.parse(
	readFileSync(join(__dirname, "package.json"), "utf-8"),
);

sade("subres <urlOrFile>", true)
	.version(version)
	.option("--timeout", "Timeout (in seconds) for navigation", 20)
	.option("--wait-until", "Puppeteer waitUntil event", "load")
	.option(
		"--format",
		"Possible output format values: json, json-short, type-url, or url-only",
		"type-url",
	)
	.option(
		"--ignore",
		"Ignore if same-origin, different-origin or field has a value",
	)
	.action(async (urlOrFile, opts) => {
		try {
			await main(urlOrFile, opts);
		} catch (error) {
			console.error(error);
			process.exit(1);
		}
	})
	.parse(process.argv);

async function main(urlOrFile, opts) {
	const inputURL = normalizeURL(urlOrFile);
	const options = {
		waitUntil: opts["wait-until"],
		timeout: opts.timeout * 1000,
	};
	const formatOutput = getFormatter(opts.format);
	const ignoreHandlers = getIgnoreHandlers(inputURL, opts.ignore);

	for await (const sr of getSubResources(inputURL, options)) {
		if (!ignoreHandlers.some(shouldIgnore => shouldIgnore(sr))) {
			console.log(formatOutput(sr));
		}
	}
}

/** @param {string} urlOrFile */
function normalizeURL(urlOrFile) {
	try {
		return new URL(urlOrFile);
	} catch {
		if (!existsSync(urlOrFile)) {
			throw new Error(`ENOENT (No such file): ${urlOrFile}`);
		}
		urlOrFile = resolve(urlOrFile).replace(/\\/g, "/");
		if (urlOrFile[0] !== "/") {
			urlOrFile = "/" + urlOrFile;
		}
		return new URL(encodeURI("file://" + urlOrFile));
	}
}

/**
 * @param {"json" | "json-short" | "type-url" | "url-only"} format
 * @typedef {{ type: string, url: URL }} SubResource
 * @returns {(subresource: SubResource) => string}
 */
function getFormatter(format) {
	switch (format) {
		case "json":
			return sr => JSON.stringify({ type: sr.type, url: urlToPlain(sr.url) });
		case "json-short":
			return sr => JSON.stringify(sr);
		case "type-url":
			return sr => `${sr.type}\t${sr.url}`;
		case "url-only":
			return sr => sr.url.href;
		default:
			throw new Error(`Invalid value for --format: ${JSON.stringify(format)}`);
	}

	/** @param {URL} url */
	function urlToPlain(url) {
		return {
			href: url.href,
			protocol: url.protocol,
			host: url.host,
			port: url.port,
			origin: url.origin,
			pathname: url.pathname,
			// @ts-expect-error
			searchParams: Object.fromEntries([...url.searchParams.entries()]),
			hash: url.hash,
		};
	}
}

/**
 * @param {URL} url entrypoint URL
 * @param {string|string[]} options
 * @typedef {(sr: SubResource) => boolean} IgnoreHandler
 */
function getIgnoreHandlers(url, options) {
	if (!options) {
		return [];
	}

	if (typeof options === "string") {
		options = [options];
	}

	/**
	 * @param {string} op
	 * @returns {IgnoreHandler}
	 */
	function getHandler(op) {
		if (op === "same-origin") {
			return sr => sr.url.origin === url.origin;
		}
		if (op === "different-origin") {
			return sr => sr.url.origin !== url.origin;
		}

		const [prop, value] = op.split(":", 2);
		const regex = new RegExp(value || ".");
		switch (prop) {
			case "type":
				return sr => regex.test(sr.type);
			case "host":
			case "pathname":
			case "protocol":
			case "origin":
			case "port":
			case "search":
				return sr => regex.test(sr.url[prop]);
			case "hash":
				return sr => regex.test(sr.url.hash.slice(1));
			case "param":
			case "query": {
				const [paramName, paramValue] = value.split("=", 2);
				const regex = new RegExp(paramValue || ".");
				return sr => regex.test(sr.url.searchParams.get(paramName) || "");
			}
			default:
				throw new Error(`Invalid --ignore filter: ${op}`);
		}
	}

	return options.map(getHandler);
}
