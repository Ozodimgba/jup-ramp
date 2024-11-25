import { Controller, Get, Param } from '@nestjs/common';
import { JupService } from './jup.service';
import { PubkeyString } from 'src/@types';

@Controller('jup')
export class JupController {
  constructor(private readonly jupService: JupService) {}

  @Get('quote/:address')
  async findQuote(@Param('address') address: PubkeyString) {
    return this.jupService.getQuote(address);
  }

  @Get('swap/:address')
  async executeSwap(@Param('address') address: PubkeyString) {
    // @Body('walletAddress') walletAddress: string, // @Body('inputMint') inputMint: PubkeyString,
    return this.jupService.flowQuoteAndSwap(address);
  }
}
