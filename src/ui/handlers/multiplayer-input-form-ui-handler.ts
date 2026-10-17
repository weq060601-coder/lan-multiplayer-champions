import { Button } from "#enums/buttons";
import type { FormModalConfig, ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";

/**
 * 一次调用要展示的内容。作为 `ui.setMode()` 的第二个参数传进来（args[1]）。
 */
export interface MultiplayerInputOptions {
  /** 弹窗标题 */
  title: string;
  /** 输入框左边的说明文字 */
  label: string;
  /** 打开时预填的值 */
  value?: string;
  /** 只允许数字（房间码用）。不满足时不关窗，就地报错。 */
  numericOnly?: boolean;
  /** 要求的确切长度（房间码 = 4）。留空则不校验长度。 */
  exactLength?: number;
  /** 允许提交空值（服务器地址留空 = 恢复自动识别）。默认 false。 */
  allowEmpty?: boolean;
}

/**
 * 联机大厅的游戏内输入框，用来取代原来的 `window.prompt()`。
 *
 * **为什么必须换掉 prompt()**：`prompt()` 是原生同步对话框，会把 JS 线程整个卡住。
 * 在安卓 WebView 上，用户点「确定」关掉它的那一下触摸会穿透到下面的游戏画布，
 * 被 Phaser 当成一次新的 ACTION 收走 —— 于是又开一个 prompt，永远弹不完。
 * 这个 handler 是画在游戏画布内部的，输入期间 UI 模式已经切走，
 * 大厅的 `processInput` 根本收不到按键，从源头上不存在这个穿透问题。
 */
export class MultiplayerInputFormUiHandler extends FormModalUiHandler {
  /**
   * ⚠️ `title` 的默认值必须**非空**。
   *
   * `setup()` 在游戏启动时就跑完了（那时还没人调 show()），它用 `!!getModalTitle()`
   * 算出一个 `hasTitle` 来定标签和输入框的 Y 坐标：有标题排在 y=31，没标题排在 y=5。
   * 而标题文字本身固定画在 y=4。所以这里要是留空串，标签就会算成「没标题」压到
   * 标题上去 —— 而且这个坐标只在 setup() 里算一次，后面改 opts 也救不回来。
   */
  private opts: MultiplayerInputOptions = { title: "输入", label: "" };

  getModalTitle(_config?: ModalConfig): string {
    return this.opts.title;
  }

  getWidth(_config?: ModalConfig): number {
    return 160;
  }

  getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  /**
   * ⚠️ 按钮文字在 `setup()` 里就定型了，改不了。
   *
   * `addButton()` 建文字对象和背景框都只发生在 setup()，之后 `updateContainer()`
   * 只重新摆位置、不重设文字，背景框宽度也不会跟着字数变。所以这里只能返回
   * 写死的两个词 —— 别想加个「按用途改按钮文字」的参数，那是无效参数。
   */
  getButtonLabels(_config?: ModalConfig): string[] {
    return ["确定", "取消"];
  }

  /**
   * 比基类多留一行错误文字的高度。
   *
   * 基类只在 `config.errorMessage` 有值时才 +12 给错误文字留位置，而本 handler 的
   * 报错是校验失败时**当场**写进 `errorMessage` 的，config 里没这个字段。不多留的话
   * 错误文字（y=47）会压在按钮（y=50）上。
   */
  public override getHeight(config?: FormModalConfig): number {
    return super.getHeight(config) + (config?.errorMessage ? 0 : 12);
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    // 只声明一个字段。标签文字在 show() 里按本次用途改，
    // 不走 updateFields() 重建 —— 那个方法每次都新建 Phaser 对象加进容器，
    // 而 clear() 只隐藏不销毁，反复打开会攒下一堆隐藏孤儿对象。
    return [{ label: "" }];
  }

  show(args: any[]): boolean {
    // ⚠️ 必须在 super.show() 之前赋值：super.show() 内部会调 getModalTitle()
    //    和 getButtonLabels()，它们都要读 this.opts。
    this.opts = args[1] as MultiplayerInputOptions;

    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as ModalConfig;

    this.formLabels[0]?.setText(this.opts.label);
    this.inputs[0].text = this.opts.value ?? "";
    this.errorMessage.setText("").setVisible(false);

    this.submitAction = () => {
      this.sanitizeInputs();
      const raw = this.inputs[0].text.trim();

      const err = this.validate(raw);
      if (err) {
        // 就地报错、不关窗，让用户接着改
        this.errorMessage.setText(err).setVisible(true);
        return;
      }

      config.buttonActions[0](raw);
    };

    return true;
  }

  /**
   * 让返回键 / B 键等于点「取消」。
   *
   * 基类只接 SUBMIT，CANCEL 会被 `ui.processInput()` 静默丢掉（handler 返回 false
   * 就没下一站了，不会漂回大厅），于是手机上只剩「点取消按钮」一条退路。
   */
  public override processInput(button: Button): boolean {
    if (button === Button.CANCEL && this.cancelAction) {
      this.cancelAction();
      return true;
    }
    return super.processInput(button);
  }

  /** 返回错误文字，或 undefined 表示通过 */
  private validate(value: string): string | undefined {
    if (!value) {
      return this.opts.allowEmpty ? undefined : "不能为空";
    }
    if (this.opts.numericOnly && !/^\d+$/.test(value)) {
      return "只能输入数字";
    }
    if (this.opts.exactLength !== undefined && value.length !== this.opts.exactLength) {
      return `需要 ${this.opts.exactLength} 位，当前 ${value.length} 位`;
    }
    return undefined;
  }
}
