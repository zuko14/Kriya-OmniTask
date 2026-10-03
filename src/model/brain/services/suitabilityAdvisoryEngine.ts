import { BrainSupplyRepository } from '../repositories/brainSupplyRepository.js';
import { CatalogueModel, SuitabilityState } from '../types/brainSupplyTypes.js';
import { ModelCertificationRepository } from '../../certification/modelCertificationRepository.js';
import { CapabilityTier } from '../../certification/certificationTypes.js';
import { logger } from '../../../core/logger/logger.js';

export interface ModelSuitabilityEvaluation {
  modelId: string;
  suitabilityState: SuitabilityState;
  isSelectable: boolean;
  namedLimitation?: string | null;
  failedHardRequirement?: string | null;
  advisoryNotice: string;
  certificationOverruled: boolean;
  effectiveStatus: 'usable_certified' | 'usable_advisory' | 'unusable_failed_cert' | 'unselectable_hard_failure';
}

export class SuitabilityAdvisoryEngine {
  private brainRepo: BrainSupplyRepository;
  private certRepo: ModelCertificationRepository;

  constructor(
    brainRepo: BrainSupplyRepository = new BrainSupplyRepository(),
    certRepo: ModelCertificationRepository = new ModelCertificationRepository()
  ) {
    this.brainRepo = brainRepo;
    this.certRepo = certRepo;
  }

  /**
   * Evaluates suitability for a model against hard requirements and fleet history (§9.6).
   */
  public async evaluateModelSuitability(
    modelId: string,
    requiredTier: CapabilityTier = 'T2',
    language = 'en'
  ): Promise<ModelSuitabilityEvaluation> {
    const catalogueItem = await this.brainRepo.getCatalogueModel(modelId);
    const advisoryNotice =
      'Advisory only — based on general model characteristics. Run the alignment check to see how it performs on your actual workforce.';

    if (!catalogueItem) {
      return {
        modelId,
        suitabilityState: 'SUPPORTED',
        isSelectable: true,
        advisoryNotice,
        certificationOverruled: false,
        effectiveStatus: 'usable_advisory',
      };
    }

    // 1. Check Hard Requirements (§9.6)
    // A model failing any of these is NOT selectable at all.
    if (
      !catalogueItem.structuredOutputSupport ||
      !catalogueItem.toolCallingSupport ||
      !catalogueItem.minContextWindowMet ||
      !catalogueItem.regionCompliant ||
      catalogueItem.suitabilityState === 'UNSUITABLE'
    ) {
      const reason =
        catalogueItem.failedHardRequirement ||
        'Fails hard requirements: Structured output adherence and tool/function calling required.';

      logger.warn(`[SUITABILITY ADVISORY] Model '${modelId}' is UNSUITABLE due to hard requirement failure: ${reason}`);

      return {
        modelId,
        suitabilityState: 'UNSUITABLE',
        isSelectable: false,
        failedHardRequirement: reason,
        advisoryNotice,
        certificationOverruled: false,
        effectiveStatus: 'unselectable_hard_failure',
      };
    }

    // 2. Check Empirical Certification Evidence (§9.6: Certification overrules advisory in both directions)
    const activeCerts = await this.certRepo.findCertifiedModels(requiredTier, language);
    const hasPassedCertification = activeCerts.some((c) => c.model_id === modelId && c.status === 'certified');
    const allModelCerts = await this.certRepo.listAllCertifications({ tier: requiredTier, language });
    const hasFailedCertification = allModelCerts.some((c) => c.model_id === modelId && c.status === 'failed');

    let effectiveStatus: ModelSuitabilityEvaluation['effectiveStatus'] = 'usable_advisory';
    let certificationOverruled = false;

    if (hasPassedCertification) {
      // e.g. A MARGINAL model that passed certification is certified and fine to use
      effectiveStatus = 'usable_certified';
      if (catalogueItem.suitabilityState === 'MARGINAL') {
        certificationOverruled = true;
      }
    } else if (hasFailedCertification) {
      // e.g. A RECOMMENDED model that failed certification is blocked despite advisory
      effectiveStatus = 'unusable_failed_cert';
      if (catalogueItem.suitabilityState === 'RECOMMENDED' || catalogueItem.suitabilityState === 'SUPPORTED') {
        certificationOverruled = true;
      }
    }

    return {
      modelId,
      suitabilityState: catalogueItem.suitabilityState,
      isSelectable: true,
      namedLimitation: catalogueItem.namedLimitation,
      failedHardRequirement: catalogueItem.failedHardRequirement,
      advisoryNotice,
      certificationOverruled,
      effectiveStatus,
    };
  }

  /**
   * Retrieves catalogue of available models with pre-computed suitability metadata.
   */
  public async getAvailableCatalogue(provider?: string): Promise<CatalogueModel[]> {
    return this.brainRepo.listCatalogueModels(provider);
  }
}
