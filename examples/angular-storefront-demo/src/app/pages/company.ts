import { Component, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import {
  injectCompanySwitch,
  injectCustomerSession,
  injectEmporixCompany,
} from "@viu/emporix-sdk-angular";

/**
 * The B2B company context.
 *
 * All three modes are rendered explicitly, and `unresolved` gets a real picker.
 * That is the point of the page: a storefront that treats «several companies, none
 * picked» as B2C shows one company's prices to a buyer who belongs to another, and
 * the bug is invisible because everything still renders.
 */
@Component({
  selector: "app-company",
  imports: [RouterLink],
  templateUrl: "./company.html",
})
export class CompanyPage {
  protected readonly session = injectCustomerSession();
  protected readonly company = injectEmporixCompany();
  protected readonly switcher = injectCompanySwitch();

  protected readonly options = computed(() => this.company.myCompanies());

  protected nameOf(entity: unknown): string {
    const e = entity as { name?: string; id?: string };
    return e.name ?? e.id ?? "(unnamed)";
  }

  protected idOf(entity: unknown): string {
    return (entity as { id?: string }).id ?? "";
  }

  protected async pick(id: string): Promise<void> {
    await this.switcher.setActiveCompany(id === "" ? null : id);
  }

  protected errorText(): string | null {
    const e = this.switcher.switchError();
    if (e === null || e === undefined) return null;
    return e instanceof Error ? e.message : String(e);
  }
}
