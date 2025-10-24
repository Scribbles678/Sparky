{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "buy",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.0,
  "take_profit_percent": 3.0
}

{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "sell",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.0,
  "take_profit_percent": 3.0
}



{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}

{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "useTrailingStop": true,
  "trailing_stop_pips": 20,
  "take_profit_percent": 1.5
}

{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "sell",
  "symbol": "GBP_USD",
  "useTrailingStop": true,
  "trailing_stop_pips": 15,
  "take_profit_percent": 2.0
}

{{strategy.order.alert_message}}

