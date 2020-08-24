// @ts-check
const puppeteer = require("puppeteer");

/**
 * @param {URL} url
 * @param {object} options
 * @param {import("puppeteer").DirectNavigationOptions["waitUntil"]} [options.waitUntil]
 * @param {import("puppeteer").DirectNavigationOptions["timeout"]} [options.timeout]
 */
async function* getSubResources(url, options = {}) {
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.setRequestInterception(true);

	/**
	 * @typedef {{ type: import('puppeteer').ResourceType, url: URL }} SubResource
	 * @type {SubResource[]}
	 */
	let subResources = [];
	let resolve;
	/** @type {Promise<void>} */
	let promise = new Promise(res => (resolve = res));
	let done = false;
	page.on("request", async request => {
		const subResource = {
			type: request.resourceType(),
			url: new URL(request.url()),
		};
		subResources.push(subResource);
		resolve();
		promise = new Promise(res => (resolve = res));
		await request.continue();
	});

	page
		.goto(url.href, options)
		.then(async response => {
			if (!response || !response.ok()) {
				const reason = response ? `. HTTP ${response.status()}` : "";
				throw new Error(`Failed to navigate to ${url}${reason}`);
			}
			await scrollPageToBottom();
		})
		.finally(async () => {
			done = true;
			await browser.close();
		});

	while (!done) {
		await promise;
		yield* subResources;
		subResources = [];
	}

	// Make sure we can also collect "lazy" requests like `<img loading="lazy">`.
	// Based on https://github.com/mbalabash/puppeteer-autoscroll-down
	function scrollPageToBottom() {
		return page.evaluate(async () => {
			const scrollStep = window.innerHeight * 0.8;
			const scrollDelay = 20;
			const getAvailableScrollHeight = () => {
				const { scrollHeight, offsetHeight, clientHeight } = document.body;
				return Math.max(scrollHeight, offsetHeight, clientHeight);
			};
			await new Promise(resolve => {
				let scrolled = 0;
				const intervalId = setInterval(() => {
					window.scrollBy(0, scrollStep);
					scrolled += scrollStep;
					if (scrolled >= getAvailableScrollHeight()) {
						clearInterval(intervalId);
						resolve();
					}
				}, scrollDelay);
			});
		});
	}
}

module.exports = { getSubResources };
