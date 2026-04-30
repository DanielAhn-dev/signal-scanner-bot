declare module "minimist" {
  type ParsedArgs = {
    _: string[];
    [key: string]: string | number | boolean | string[] | undefined;
  };

  function minimist(
    args: string[],
    opts?: {
      string?: string[];
      boolean?: string[];
      alias?: Record<string, string | string[]>;
      default?: Record<string, string | number | boolean>;
      unknown?: (arg: string) => boolean;
      "--"?: boolean;
      stopEarly?: boolean;
    }
  ): ParsedArgs;

  export default minimist;
}
