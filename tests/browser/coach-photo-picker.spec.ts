import { test, expect, browserUser } from "./fixtures";
import sharp from "sharp";

for (const keyboard of [false, true]) {
  test(`photo choices are immediately reachable after opening attachments (${keyboard ? "keyboard open" : "phone"})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#coach");
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    const draft = page.getByLabel("Message your coach");
    await draft.fill("My lunch today. ".repeat(35));
    if (keyboard) {
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true,
          value: 390,
        });
        Object.defineProperty(window.visualViewport, "offsetTop", {
          configurable: true,
          value: 45,
        });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
      await expect(page.locator("html")).toHaveAttribute(
        "data-keyboard-open",
        "",
      );
    }
    await page.getByRole("button", { name: "Add images", exact: true }).click();
    await page.screenshot({ path: info.outputPath("photo-options.png") });
    for (const name of ["Take photo", "Attach image"]) {
      const picker = page.getByLabel(name, { exact: true });
      await expect(picker).toBeInViewport({ ratio: 1 });
      const bounds = (await picker.boundingBox())!;
      if (keyboard) {
        expect(bounds.y).toBeGreaterThanOrEqual(45);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(435);
      }
      // Verify the actual native chooser opens, not just programmatic setInputFiles.
      const chooser = page.waitForEvent("filechooser");
      await picker.click();
      await (await chooser).setFiles([]);
    }
    await expect(draft).toHaveValue("My lunch today. ".repeat(35));
  });
}

for (const failsFirst of [false, true]) {
  test(`selecting a photo attaches it to the draft without sending (${failsFirst ? "retry after error" : "success"})`, async ({
    page,
    context,
  }, info) => {
    const pixels = await sharp({
      create: { width: 180, height: 240, channels: 3, background: "#adcca7" },
    })
      .jpeg()
      .toBuffer();
    let uploads = 0;
    let messages = 0;
    let sentPhotos: string[] = [];
    const photoId = crypto.randomUUID();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await context.route("**/api/images", async (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: { images: [] } });
      uploads++;
      expect(route.request().headers()["x-journal-account"]).toBe(
        browserUser.id,
      );
      const body = route.request().postDataJSON();
      expect(body.autoTag).toBe(true);
      expect(
        Buffer.from(body.image, "base64").subarray(0, 2).toString("hex"),
      ).toBe("ffd8");
      if (failsFirst && uploads === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Photo upload interrupted. Please try again." },
        });
      await uploadGate;
      return route.fulfill({
        json: {
          id: photoId,
          label: "Uploaded image",
          date: body.date,
          bytes: pixels.length,
          createdAt: new Date().toISOString(),
          version: 1,
          category: "food",
          classification: {
            status: "ready",
            confidence: "high",
            source: "automatic",
            tags: ["meal"],
          },
        },
      });
    });
    await context.route(`**/api/images/${photoId}`, (route) =>
      route.fulfill({ body: pixels, contentType: "image/jpeg" }),
    );
    await context.route("**/api/agent", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { enabled: true, turns: [] } });
      messages++;
      const body = route.request().postDataJSON();
      sentPhotos = body.photoIds;
      expect(body.message).toBe("This was my lunch.");
      return route.fulfill({
        json: { reply: "Synthetic photo received.", proposals: [] },
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#coach");
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    const draft = page.getByLabel("Message your coach");
    await draft.fill("This was my lunch.");
    const choose = async () => {
      await page
        .getByRole("button", { name: "Add images", exact: true })
        .click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByLabel("Attach image", { exact: true }).click();
      await (
        await chooser
      ).setFiles({ name: "lunch.jpg", mimeType: "image/jpeg", buffer: pixels });
      await expect(
        page.getByRole("dialog", { name: "Add photos to Coach" }),
      ).toHaveCount(0);
    };
    await choose();
    if (failsFirst) {
      await expect(
        page.getByRole("alert").filter({ hasText: "Photo upload interrupted" }),
      ).toBeVisible();
      await expect(draft).toHaveValue("This was my lunch.");
      await choose();
    }
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Saving and tagging your photo" }),
    ).toBeVisible();
    expect(messages).toBe(0);
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeDisabled();
    releaseUpload();
    await expect(
      page.getByRole("img", { name: "Image ready to send" }),
    ).toBeVisible();
    await expect(draft).toHaveValue("This was my lunch.");
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeEnabled();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Saving and tagging your photo" }),
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("photo-attached.png") });
    expect(messages).toBe(0);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByText("Synthetic photo received.", { exact: true }),
    ).toBeVisible();
    expect(sentPhotos).toEqual([photoId]);
    expect(uploads).toBe(failsFirst ? 2 : 1);
  });
}
