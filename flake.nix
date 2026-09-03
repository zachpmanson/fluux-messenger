{
  description = "zachpmanson/fluux-messenger fork — dev shell + built web bundle";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
          ];
        };

        # The built static web bundle, served same-origin by caddy on naboo
        # (replacing the converse.js fork). Only the *web* target is packaged
        # here — the Tauri desktop builds would drag in rustPlatform + a
        # cargoHash + webkitgtk, and naboo only needs the static site.
        #
        # buildNpmPackage isn't platform-specific, so `nix build .#fluux`
        # sanity-checks this on a Mac without a Linux builder.
        packages.default = self.packages.${system}.fluux;
        packages.fluux = pkgs.buildNpmPackage {
          pname = "fluux";
          version = "0.17.2";
          src = ./.;

          # Regenerate after any package-lock.json change with:
          #   nix run nixpkgs#prefetch-npm-deps -- package-lock.json
          npmDepsHash = "sha256-/MLviaYoWvOIBy7RSD7b4vc05gOtUB4rx2sF3POL/h4=";

          nodejs = pkgs.nodejs_24;

          # npm workspaces monorepo: the root `build` script runs
          # `build -w @fluux/sdk` then `build -w @xmpp/fluux` (tsc && vite
          # build), so npm ci at the root wires up both workspaces and this
          # single script produces apps/fluux/dist.
          npmBuildScript = "build";

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r apps/fluux/dist $out/dist
            runHook postInstall
          '';
        };
      });
}
