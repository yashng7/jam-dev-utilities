import { render, screen } from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import WebPConverter from "../../../pages/utilities/webp-converter";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(global, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: ResizeObserverMock,
});

const uploadImage = async (user: UserEvent) => {
  const fileInput = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;

  await user.upload(
    fileInput,
    new File(["image"], "photo.png", { type: "image/png" })
  );
};

describe("WebPConverter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("lets users switch to target file size compression", async () => {
    const user = userEvent.setup();
    render(<WebPConverter />);
    await uploadImage(user);

    expect(screen.getByText("Quality: 80%")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Target file size" }));

    expect(
      screen.getByLabelText(/Target file size \(KB, per image\)/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/never enlarged/i).length).toBeGreaterThan(0);
  });

  test("restores the saved target size", async () => {
    localStorage.setItem("webp-converter-mode", "target-size");
    localStorage.setItem("webp-converter-target-size", "1.5");

    const user = userEvent.setup();
    render(<WebPConverter />);
    await uploadImage(user);

    expect(screen.getByDisplayValue("1.5")).toBeInTheDocument();
  });
});
